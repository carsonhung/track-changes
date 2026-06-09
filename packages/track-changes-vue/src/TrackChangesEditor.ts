import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import { Editor, EditorContent } from '@tiptap/vue-3';
import StarterKit from '@tiptap/starter-kit';
import type { Transaction } from '@tiptap/pm/state';
import {
  createTrackChangesExtension,
  setSuggesting,
  setSuggestionAuthor,
  acceptOn,
  rejectOn,
  acceptAllOn,
  rejectAllOn,
  listSuggestions,
  toClean,
  type SuggestionSummary,
} from '@tdg-reports/track-changes-core';

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

type Json = Record<string, unknown>;

const EMPTY_DOC: Json = { type: 'doc', content: [{ type: 'paragraph' }] };

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
    modelValue: { type: Object as PropType<Json | null>, default: null },
    authorId: { type: String as PropType<string | null>, default: null },
    mode: { type: String as PropType<EditorMode>, default: 'suggesting' },
    readonly: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (_value: Json) => true,
    ready: (_editor: Editor) => true,
  },
  setup(props, { emit, expose }) {
    const editor = shallowRef<Editor | null>(null);

    const isEditable = (mode: EditorMode, readonly: boolean) => !readonly && mode !== 'viewing';

    onMounted(() => {
      const instance = new Editor({
        content: props.modelValue ?? EMPTY_DOC,
        editable: isEditable(props.mode, props.readonly),
        extensions: [
          StarterKit,
          createTrackChangesExtension({
            suggesting: props.mode === 'suggesting',
            authorId: props.authorId,
          }),
        ],
        onUpdate: ({ editor: ed }) => emit('update:modelValue', ed.getJSON() as Json),
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
      if (tr.docChanged || tr.steps.length) ed.view.dispatch(tr);
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
      listSuggestions: (): SuggestionSummary[] =>
        editor.value ? listSuggestions(editor.value.state.doc) : [],
      getClean: (): Json | null =>
        editor.value ? (toClean(editor.value.state.doc).toJSON() as Json) : null,
    };
    expose(api);

    return () => h('div', { class: 'tc-editor' }, editor.value ? [h(EditorContent, { editor: editor.value })] : []);
  },
});
