import { Editor, type Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  createTrackChangesExtension,
  setSuggestionAuthor,
  getTrackChangesState,
  createEditorCommands,
  createSuggestionReview,
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
  type CharacterCountLimits,
  type EditorFeature,
  type EditorFeatureContext,
  type EditorToolbarItem,
  type EditorUploadHandler,
  type EditorMode,
  type EditorFormat,
  type SuggestionSummary,
  type TrackChangesEditorCommands,
} from 'track-changes-core';

type Json = Record<string, unknown>;

export interface TrackChangesEditorOptions extends CharacterCountLimits {
  /** Initial document: PM JSON or HTML string. */
  content?: Json | string | null;
  /** Format passed to `onChange` / returned by `getValue` (input accepts either). */
  format?: EditorFormat;
  authorId?: string | null;
  mode?: EditorMode;
  readonly?: boolean;
  /** Extra Tiptap node/mark extensions. Fixed for the editor's lifetime. */
  extraExtensions?: Extensions;
  /** CKEditor-style feature plugins. Fixed for the editor's lifetime. */
  features?: EditorFeature[];
  /** Host upload glue consumed by upload-needing features (image upload). */
  uploadHandler?: EditorUploadHandler | null;
  /** Called with the document (in `format`) on every change. */
  onChange?: (value: Json | string) => void;
  /** Called with the outstanding suggestions at mount and on every change. */
  onSuggestionsChange?: (suggestions: SuggestionSummary[]) => void;
}

/** Handle returned by `createTrackChangesEditor`. */
export interface TrackChangesEditorHandle extends TrackChangesEditorCommands {
  /** The underlying Tiptap editor. */
  readonly editor: Editor;
  /** The `.tc-editor` root element appended to the target. */
  readonly element: HTMLElement;
  getMode: () => EditorMode;
  setMode: (mode: EditorMode) => void;
  setReadonly: (readonly: boolean) => void;
  setAuthor: (authorId: string | null) => void;
  /** Swap the upload handler (e.g. after auth). */
  setUploadHandler: (handler: EditorUploadHandler | null) => void;
  /** Current document in `format`. */
  getValue: () => Json | string;
  /**
   * Replace the whole document. Explicit replacement: resets selection and
   * undo history, and does not fire `onChange`.
   */
  setContent: (content: Json | string | null) => void;
  /** Destroy the editor and remove its DOM. */
  destroy: () => void;
}

interface ToolbarButton {
  item: EditorToolbarItem;
  el: HTMLButtonElement;
}

/**
 * Mount a track-changes editor into `target` without any UI framework.
 * Renders the same markup as the Vue/React `<TrackChangesEditor>`
 * (`.tc-editor` > `.tc-toolbar` + content + `.tc-charcount`), so
 * `track-changes-styles` applies unchanged.
 */
export function createTrackChangesEditor(
  target: HTMLElement,
  options: TrackChangesEditorOptions = {},
): TrackChangesEditorHandle {
  const doc = target.ownerDocument;
  const features = options.features ?? [];
  const format = options.format ?? 'json';
  let mode: EditorMode = options.mode ?? 'suggesting';
  let readonly = options.readonly ?? false;
  let upload: EditorUploadHandler | null = options.uploadHandler ?? null;

  const root = doc.createElement('div');
  root.className = 'tc-editor';
  const toolbar = doc.createElement('div');
  toolbar.className = 'tc-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  const content = doc.createElement('div');
  root.append(toolbar, content);
  target.appendChild(root);

  const editor = new Editor({
    element: content,
    content: options.content || EMPTY_DOC,
    editable: isEditorEditable(mode, readonly),
    extensions: [
      StarterKit.configure(resolveStarterKitOptions(features)),
      createTrackChangesExtension({
        suggesting: mode === 'suggesting',
        authorId: options.authorId ?? null,
      }),
      ...featureExtensions(features),
      ...(options.extraExtensions ?? []),
    ],
    onUpdate: ({ editor: ed }) => options.onChange?.(serializeEditor(ed, format)),
  });

  setEditorUploadHandler(editor, upload);
  const ctx = (): EditorFeatureContext => ({ editor, upload });

  // Buttons are built once and updated in place, so focus and hover survive
  // the per-transaction refresh.
  const buttons: ToolbarButton[] = featureToolbarItems(features).map((item) => {
    const el = doc.createElement('button');
    el.type = 'button';
    el.className = 'tc-toolbar-btn';
    el.title = item.label;
    el.setAttribute('aria-label', item.label);
    el.textContent = item.text;
    el.addEventListener('click', () => void item.run(ctx()));
    toolbar.appendChild(el);
    return { item, el };
  });

  let counter: { root: HTMLElement; chars: HTMLElement; words: HTMLElement } | null = null;
  if (isCharacterCountVisible(options)) {
    const counterRoot = doc.createElement('div');
    counterRoot.className = 'tc-charcount';
    counterRoot.setAttribute('role', 'status');
    counterRoot.setAttribute('aria-live', 'polite');
    const chars = doc.createElement('span');
    const words = doc.createElement('span');
    counterRoot.append(chars, words);
    root.appendChild(counterRoot);
    counter = { root: counterRoot, chars, words };
  }

  const render = () => {
    toolbar.hidden = !buttons.length || !isToolbarVisible(mode, readonly);
    if (!toolbar.hidden) {
      const c = ctx();
      for (const { item, el } of buttons) {
        el.disabled = item.isEnabled ? !item.isEnabled(c) : false;
        el.classList.toggle('tc-toolbar-btn--active', item.isActive?.(c) ?? false);
      }
    }
    if (counter) {
      const count = characterCountView(editor.state.doc, options);
      counter.root.classList.toggle('tc-charcount--over', count.over);
      counter.chars.className = count.charsOver
        ? 'tc-charcount-chars tc-charcount-part--over'
        : 'tc-charcount-chars';
      counter.chars.textContent = count.charText;
      counter.words.className = count.wordsOver
        ? 'tc-charcount-words tc-charcount-part--over'
        : 'tc-charcount-words';
      counter.words.textContent = ` · ${count.wordText}`;
    }
  };
  editor.on('transaction', render);
  render();

  const review = options.onSuggestionsChange
    ? createSuggestionReview(options.onSuggestionsChange)
    : null;
  review?.bind(editor);

  const commands = createEditorCommands(() => (editor.isDestroyed ? null : editor));

  const applyEditable = () => {
    const editable = isEditorEditable(mode, readonly);
    if (editor.isEditable !== editable) editor.setEditable(editable);
    render();
  };

  return {
    ...commands,
    editor,
    element: root,
    getMode: () => mode,
    setMode: (next) => {
      mode = next;
      if (getTrackChangesState(editor.state).suggesting !== (next === 'suggesting')) {
        commands.setSuggesting(next === 'suggesting');
      }
      applyEditable();
    },
    setReadonly: (next) => {
      readonly = next;
      applyEditable();
    },
    setAuthor: (authorId) => {
      setSuggestionAuthor(authorId)(editor.state, (tr) => editor.view.dispatch(tr));
    },
    setUploadHandler: (handler) => {
      upload = handler;
      setEditorUploadHandler(editor, handler);
      render();
    },
    getValue: () => serializeEditor(editor, format),
    setContent: (next) => {
      replaceEditorContent(editor, next);
    },
    destroy: () => {
      review?.destroy();
      editor.off('transaction', render);
      editor.destroy();
      root.remove();
    },
  };
}
