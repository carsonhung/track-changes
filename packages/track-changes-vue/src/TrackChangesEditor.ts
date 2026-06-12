import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import { Editor, EditorContent, type Extensions } from '@tiptap/vue-3';
import StarterKit, { type StarterKitOptions } from '@tiptap/starter-kit';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { Transaction } from '@tiptap/pm/state';
import type { TrackChangesEditorLike } from './useTrackChangesReview';
import type { EditorFeature, EditorFeatureContext, EditorUploadHandler } from './features/types';
import {
  createTrackChangesExtension,
  setSuggesting,
  setSuggestionAuthor,
  suggestInsertNode,
  suggestDeleteNode,
  acceptOn,
  rejectOn,
  acceptAllOn,
  rejectAllOn,
  listSuggestions,
  toClean,
  countCleanText,
  tagSuggestionTx,
  docToHtml,
  type SuggestionSummary,
} from '@tdg-reports/track-changes-core';

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

/**
 * Persistence format for `modelValue` / `update:modelValue`.
 *
 * - `json` — ProseMirror JSON document (object). Default, backward compatible.
 * - `html` — HTML string. Lossless: suggestions are real `<ins>`/`<del>` tags
 *   and `data-suggestion-*` attributes that round-trip through the schema's
 *   parse rules, so the value can be stored as plain text in a DB and renders
 *   correctly (including print/PDF) without the editor.
 */
export type EditorFormat = 'json' | 'html';

type Json = Record<string, unknown>;

/**
 * Imperative API exposed by `<TrackChangesEditor>` via a template ref. Vue
 * unwraps refs on the exposed instance, so `editor` reads as `Editor | null`.
 */
export interface TrackChangesEditorApi extends TrackChangesEditorLike {
  editor: Editor | null;
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  setSuggesting: (on: boolean) => void;
  /** Insert a node (inline atom or trackable block) as a tracked insertion. */
  insertNode: (node: PMNode, at?: number) => void;
  /** Suggest deletion of the node at `pos` (keep it, mark it deleted). */
  deleteNode: (pos: number) => void;
  listSuggestions: () => SuggestionSummary[];
  getClean: () => Json | null;
  /** Current (tracked) document as an HTML string. */
  getHTML: () => string | null;
  /** Accept-all projection of the document as an HTML string. */
  getCleanHtml: () => string | null;
}

const EMPTY_DOC: Json = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Formatting-gated StarterKit pieces, disabled unless a feature re-enables
 * them via `EditorFeature.starterKitOptions` (the formatting feature does,
 * per its `buttons`). Disabling removes the mark/node from the schema, so the
 * restriction is real: no keyboard shortcut, no markdown input rule, and
 * pasted formatting is stripped on parse. Structure (paragraphs, hard breaks,
 * history, cursors) stays enabled always.
 */
const RESTRICTED_STARTER_KIT: Partial<StarterKitOptions> = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  heading: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
  blockquote: false,
  codeBlock: false,
  horizontalRule: false,
};

/**
 * Thin Vue 3 adapter. Owns a Tiptap `Editor` with StarterKit + the
 * track-changes extension. Mutations are emitted via `update:modelValue`;
 * accept/reject are exposed imperatively. One-way binding after mount (the
 * editor owns its document) to avoid feedback loops — re-mount via `:key` to
 * load a different document.
 */
export default defineComponent({
  name: 'TrackChangesEditor',
  props: {
    /** PM JSON doc (`format: 'json'`) or HTML string (`format: 'html'`). */
    modelValue: {
      type: [Object, String] as PropType<Json | string | null>,
      default: null,
    },
    /** Format emitted via `update:modelValue` (input accepts either, always). */
    format: { type: String as PropType<EditorFormat>, default: 'json' },
    authorId: { type: String as PropType<string | null>, default: null },
    mode: { type: String as PropType<EditorMode>, default: 'suggesting' },
    readonly: { type: Boolean, default: false },
    /**
     * Extra Tiptap node/mark extensions (e.g. Image, Table) so the host can
     * track node-level changes. Make trackable block nodes carry the
     * `suggestion` attribute via `suggestionNodeAttributes()` from the core.
     */
    extraExtensions: { type: Array as PropType<Extensions>, default: () => [] },
    /**
     * CKEditor-style feature plugins (see `features/types.ts`). Each feature
     * contributes Tiptap extensions plus toolbar items rendered by the
     * built-in toolbar (hidden when no feature contributes items, or in
     * viewing/readonly state).
     */
    features: { type: Array as PropType<EditorFeature[]>, default: () => [] },
    /**
     * Host upload glue consumed by upload-needing features (image upload).
     * The package never talks to a backend itself.
     */
    uploadHandler: {
      type: Function as unknown as PropType<EditorUploadHandler | null>,
      default: null,
    },
    /**
     * Soft character limit. When set, a footer shows the clean-projection
     * character/word count ("123 / 2,000") and turns into an over-limit state
     * past the cap. The count is of the *accept-all projection*: a pending
     * deletion stops counting immediately, a pending insertion counts right
     * away. Input is never hard-blocked (in suggesting mode the tracked text
     * physically stays in the doc, so blocking would be wrong) — enforce at
     * submit/validation time via the same projection.
     */
    maxCharacters: { type: Number as PropType<number | null>, default: null },
    /**
     * Soft word limit (same clean-projection semantics as `maxCharacters`).
     * Either cap alone or both together; the footer flags the over-limit
     * state when any set cap is exceeded.
     */
    maxWords: { type: Number as PropType<number | null>, default: null },
    /** Show the character/word footer even without a cap. */
    showCharacterCount: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (_value: Json | string) => true,
    ready: (_editor: Editor) => true,
  },
  setup(props, { emit, expose }) {
    const editor = shallowRef<Editor | null>(null);
    // Bumped on every editor transaction so toolbar isEnabled/isActive re-evaluate.
    const editorTick = ref(0);

    const isEditable = (mode: EditorMode, readonly: boolean) => !readonly && mode !== 'viewing';

    onMounted(() => {
      const starterKitConfig = props.features.reduce<Partial<StarterKitOptions>>(
        (cfg, f) => ({ ...cfg, ...(f.starterKitOptions?.() ?? {}) }),
        { ...RESTRICTED_STARTER_KIT },
      );
      const instance = new Editor({
        // Tiptap accepts both PM JSON and an HTML string as initial content,
        // so the input side is format-agnostic regardless of the `format` prop.
        content: props.modelValue || EMPTY_DOC,
        editable: isEditable(props.mode, props.readonly),
        extensions: [
          StarterKit.configure(starterKitConfig),
          createTrackChangesExtension({
            suggesting: props.mode === 'suggesting',
            authorId: props.authorId,
          }),
          ...props.features.flatMap((f) => f.extensions?.() ?? []),
          ...props.extraExtensions,
        ],
        onUpdate: ({ editor: ed }) =>
          emit('update:modelValue', props.format === 'html' ? ed.getHTML() : (ed.getJSON() as Json)),
      });
      instance.on('transaction', () => {
        editorTick.value += 1;
      });
      editor.value = instance;
      emit('ready', instance);
    });

    onBeforeUnmount(() => {
      editor.value?.destroy();
      editor.value = null;
    });

    const applyTr = (mutate: (tr: Transaction) => void) => {
      const ed = editor.value;
      if (!ed) return;
      const tr = ed.state.tr;
      mutate(tr);
      // Accept/reject transactions are already suggestion-resolved; tag them so
      // the rewrite plugin doesn't re-encode them as new suggestions.
      if (tr.docChanged || tr.steps.length) ed.view.dispatch(tagSuggestionTx(tr));
    };

    const dispatchCmd = (cmd: (state: Editor['state'], dispatch: (tr: Transaction) => void) => boolean) => {
      const ed = editor.value;
      if (!ed) return;
      cmd(ed.state, (tr) => ed.view.dispatch(tr));
    };

    watch(
      () => props.mode,
      (mode) => {
        const ed = editor.value;
        if (!ed) return;
        ed.setEditable(isEditable(mode, props.readonly));
        dispatchCmd(setSuggesting(mode === 'suggesting'));
      },
    );

    watch(
      () => props.readonly,
      (readonly) => editor.value?.setEditable(isEditable(props.mode, readonly)),
    );

    watch(
      () => props.authorId,
      (authorId) => dispatchCmd(setSuggestionAuthor(authorId)),
    );

    const api = {
      editor,
      accept: (id: string) => applyTr((tr) => acceptOn(tr, id)),
      reject: (id: string) => applyTr((tr) => rejectOn(tr, id)),
      acceptAll: () => applyTr((tr) => acceptAllOn(tr)),
      rejectAll: () => applyTr((tr) => rejectAllOn(tr)),
      setSuggesting: (on: boolean) => dispatchCmd(setSuggesting(on)),
      /** Insert a node (atom or trackable block) as a tracked insertion. */
      insertNode: (node: PMNode, at?: number) => dispatchCmd(suggestInsertNode(node, at)),
      /** Suggest deletion of the node at `pos` (keep it, mark it deleted). */
      deleteNode: (pos: number) => dispatchCmd(suggestDeleteNode(pos)),
      listSuggestions: (): SuggestionSummary[] =>
        editor.value ? listSuggestions(editor.value.state.doc) : [],
      getClean: (): Json | null =>
        editor.value ? (toClean(editor.value.state.doc).toJSON() as Json) : null,
      getHTML: (): string | null => editor.value?.getHTML() ?? null,
      getCleanHtml: (): string | null =>
        editor.value ? docToHtml(toClean(editor.value.state.doc)) : null,
    };
    expose(api);

    const renderToolbar = (ed: Editor) => {
      if (props.readonly || props.mode === 'viewing') return null;
      const items = props.features.flatMap((f) => f.toolbarItems?.() ?? []);
      if (!items.length) return null;
      void editorTick.value; // subscribe: re-render on every editor transaction
      const ctx: EditorFeatureContext = { editor: ed, upload: props.uploadHandler ?? null };
      return h(
        'div',
        { class: 'tc-toolbar', role: 'toolbar' },
        items.map((item) =>
          h(
            'button',
            {
              key: item.id,
              type: 'button',
              class: ['tc-toolbar-btn', { 'tc-toolbar-btn--active': item.isActive?.(ctx) ?? false }],
              disabled: item.isEnabled ? !item.isEnabled(ctx) : false,
              title: item.label,
              'aria-label': item.label,
              onClick: () => void item.run(ctx),
            },
            item.text,
          ),
        ),
      );
    };

    const renderCharacterCount = (ed: Editor) => {
      if (props.maxCharacters == null && props.maxWords == null && !props.showCharacterCount) {
        return null;
      }
      void editorTick.value; // subscribe: recount on every editor transaction
      const { characters, words } = countCleanText(ed.state.doc);
      const charsOver = props.maxCharacters != null && characters > props.maxCharacters;
      const wordsOver = props.maxWords != null && words > props.maxWords;
      const charText =
        props.maxCharacters != null
          ? `${characters.toLocaleString()} / ${props.maxCharacters.toLocaleString()}`
          : characters.toLocaleString();
      const wordText =
        props.maxWords != null
          ? `${words.toLocaleString()} / ${props.maxWords.toLocaleString()}w`
          : `${words.toLocaleString()}w`;
      return h(
        'div',
        {
          class: ['tc-charcount', { 'tc-charcount--over': charsOver || wordsOver }],
          role: 'status',
          'aria-live': 'polite',
        },
        [
          h(
            'span',
            { class: ['tc-charcount-chars', { 'tc-charcount-part--over': charsOver }] },
            charText,
          ),
          h(
            'span',
            { class: ['tc-charcount-words', { 'tc-charcount-part--over': wordsOver }] },
            ` · ${wordText}`,
          ),
        ],
      );
    };

    return () => {
      const ed = editor.value;
      if (!ed) return h('div', { class: 'tc-editor' });
      const toolbar = renderToolbar(ed);
      const charCount = renderCharacterCount(ed);
      return h('div', { class: 'tc-editor' }, [
        ...(toolbar ? [toolbar] : []),
        h(EditorContent, { editor: ed }),
        ...(charCount ? [charCount] : []),
      ]);
    };
  },
});
