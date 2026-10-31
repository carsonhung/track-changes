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
import StarterKit from '@tiptap/starter-kit';
import type { TrackChangesEditorLike } from './useTrackChangesReview';
import {
  createTrackChangesExtension,
  setSuggestionAuthor,
  createModelHydrationGuard,
  createEditorCommands,
  setEditorUploadHandler,
  resolveStarterKitOptions,
  featureExtensions,
  featureToolbarItems,
  isEditorEditable,
  isToolbarVisible,
  serializeEditor,
  replaceEditorContent,
  isCharacterCountVisible,
  characterCountView,
  EMPTY_DOC,
  type EditorFeature,
  type EditorFeatureContext,
  type EditorUploadHandler,
  type EditorModelValue,
  type EditorMode,
  type EditorFormat,
  type TrackChangesEditorCommands,
} from 'track-changes-core';

export type { EditorMode, EditorFormat };

type Json = Record<string, unknown>;

/**
 * Imperative API exposed by `<TrackChangesEditor>` via a template ref. Vue
 * unwraps refs on the exposed instance, so `editor` reads as `Editor | null`.
 */
export interface TrackChangesEditorApi extends TrackChangesEditorLike, TrackChangesEditorCommands {
  editor: Editor | null;
}

/**
 * Thin Vue 3 adapter. Owns a Tiptap `Editor` with StarterKit + the
 * track-changes extension. Mutations are emitted via `update:modelValue`;
 * accept/reject are exposed imperatively. A mounted empty editor accepts one
 * asynchronous external hydration; after meaningful content or a local edit,
 * the editor owns its document to preserve selection, history, and draft work.
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
     * CKEditor-style feature plugins (see `EditorFeature` in the core). Each
     * feature contributes Tiptap extensions plus toolbar items rendered by the
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
     * past the cap. Never hard-blocks input — see `CharacterCountLimits`.
     */
    maxCharacters: { type: Number as PropType<number | null>, default: null },
    /** Soft word limit (same clean-projection semantics as `maxCharacters`). */
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
    const hydrationGuard = createModelHydrationGuard(props.modelValue as EditorModelValue);
    // Bumped on every editor transaction so toolbar isEnabled/isActive re-evaluate.
    const editorTick = ref(0);

    onMounted(() => {
      const instance = new Editor({
        // Tiptap accepts both PM JSON and an HTML string as initial content,
        // so the input side is format-agnostic regardless of the `format` prop.
        content: props.modelValue || EMPTY_DOC,
        editable: isEditorEditable(props.mode, props.readonly),
        extensions: [
          StarterKit.configure(resolveStarterKitOptions(props.features)),
          createTrackChangesExtension({
            suggesting: props.mode === 'suggesting',
            authorId: props.authorId,
          }),
          ...featureExtensions(props.features),
          ...props.extraExtensions,
        ],
        onUpdate: ({ editor: ed }) => {
          const value = serializeEditor(ed, props.format);
          hydrationGuard.markLocalChange(value);
          emit('update:modelValue', value);
        },
      });
      instance.on('transaction', () => {
        editorTick.value += 1;
      });
      setEditorUploadHandler(instance, props.uploadHandler ?? null);
      editor.value = instance;
      emit('ready', instance);
    });

    onBeforeUnmount(() => {
      editor.value?.destroy();
      editor.value = null;
    });

    const commands = createEditorCommands(() => editor.value);

    watch(
      () => props.mode,
      (mode) => {
        const ed = editor.value;
        if (!ed) return;
        ed.setEditable(isEditorEditable(mode, props.readonly));
        commands.setSuggesting(mode === 'suggesting');
      },
    );

    watch(
      () => props.readonly,
      (readonly) => editor.value?.setEditable(isEditorEditable(props.mode, readonly)),
    );

    watch(
      () => props.uploadHandler,
      (handler) => {
        if (editor.value) setEditorUploadHandler(editor.value, handler ?? null);
      },
    );

    watch(
      () => props.authorId,
      (authorId) => {
        const ed = editor.value;
        if (ed) setSuggestionAuthor(authorId)(ed.state, (tr) => ed.view.dispatch(tr));
      },
    );

    watch(
      () => props.modelValue,
      (modelValue) => {
        const ed = editor.value;
        if (!ed || !hydrationGuard.shouldHydrate(modelValue as EditorModelValue)) return;
        // This path is only reachable before local editing, so replacing the
        // initial empty document cannot discard selection/history/suggestions.
        replaceEditorContent(ed, modelValue as Json | string | null);
      },
      { deep: true },
    );

    expose({ editor, ...commands });

    const renderToolbar = (ed: Editor) => {
      if (!isToolbarVisible(props.mode, props.readonly)) return null;
      const items = featureToolbarItems(props.features);
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
      if (!isCharacterCountVisible(props)) return null;
      void editorTick.value; // subscribe: recount on every editor transaction
      const count = characterCountView(ed.state.doc, props);
      return h(
        'div',
        {
          class: ['tc-charcount', { 'tc-charcount--over': count.over }],
          role: 'status',
          'aria-live': 'polite',
        },
        [
          h(
            'span',
            { class: ['tc-charcount-chars', { 'tc-charcount-part--over': count.charsOver }] },
            count.charText,
          ),
          h(
            'span',
            { class: ['tc-charcount-words', { 'tc-charcount-part--over': count.wordsOver }] },
            ` · ${count.wordText}`,
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
