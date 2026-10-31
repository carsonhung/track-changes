import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Editor, EditorContent, type Extensions } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import {
  createTrackChangesExtension,
  setSuggestionAuthor,
  getTrackChangesState,
  createModelHydrationGuard,
  createEditorCommands,
  setEditorUploadHandler,
  resolveStarterKitOptions,
  featureExtensions,
  featureToolbarItems,
  isEditorEditable,
  isToolbarVisible,
  serializeEditor,
  isCharacterCountVisible,
  characterCountView,
  EMPTY_DOC,
  type CharacterCountLimits,
  type EditorFeature,
  type EditorFeatureContext,
  type EditorUploadHandler,
  type EditorMode,
  type EditorFormat,
  type TrackChangesEditorCommands,
} from 'track-changes-core';

export type { EditorMode, EditorFormat };

type Json = Record<string, unknown>;

export interface TrackChangesEditorProps extends CharacterCountLimits {
  /**
   * PM JSON doc or HTML string. Read once at mount; afterwards a still-empty
   * editor accepts one asynchronous hydration (data arriving after mount).
   * Once the doc has content or the user edited, the editor owns its
   * document, so feeding `onChange` output back in is safe and never resets
   * selection or history.
   */
  value?: Json | string | null;
  /** Called with the document (in `format`) on every change. */
  onChange?: (value: Json | string) => void;
  /** Format passed to `onChange` (input accepts either, always). */
  format?: EditorFormat;
  authorId?: string | null;
  mode?: EditorMode;
  readonly?: boolean;
  /**
   * Extra Tiptap node/mark extensions. Read once at mount (changing the
   * schema of a live editor is not supported); remount via `key` to swap.
   */
  extraExtensions?: Extensions;
  /** CKEditor-style feature plugins. Read once at mount, like `extraExtensions`. */
  features?: EditorFeature[];
  /** Host upload glue consumed by upload-needing features (image upload). */
  uploadHandler?: EditorUploadHandler | null;
  /** Called with the Tiptap editor once it exists (again after a remount). */
  onReady?: (editor: Editor) => void;
  /** Extra class on the `.tc-editor` root. */
  className?: string;
}

/** Imperative API exposed via `ref`. `editor` is null before mount. */
export interface TrackChangesEditorRef extends TrackChangesEditorCommands {
  editor: Editor | null;
}

const NO_FEATURES: EditorFeature[] = [];

/**
 * Thin React adapter, behaviorally identical to the Vue `<TrackChangesEditor>`:
 * owns a Tiptap `Editor` with StarterKit + the track-changes extension,
 * reports changes via `onChange`, and exposes accept/reject imperatively.
 */
export const TrackChangesEditor = forwardRef<TrackChangesEditorRef, TrackChangesEditorProps>(
  function TrackChangesEditor(props, ref) {
    const {
      value = null,
      mode = 'suggesting',
      readonly = false,
      authorId = null,
      features = NO_FEATURES,
      uploadHandler = null,
      className,
    } = props;

    const [editor, setEditor] = useState<Editor | null>(null);
    // Bumped on every editor transaction so toolbar isEnabled/isActive re-evaluate.
    const [, rerender] = useReducer((n: number) => n + 1, 0);
    const latest = useRef(props);
    latest.current = props;
    const [hydrationGuard] = useState(() => createModelHydrationGuard(value));

    useEffect(() => {
      const p = latest.current;
      const initialFeatures = p.features ?? NO_FEATURES;
      const initialMode = p.mode ?? 'suggesting';
      const instance = new Editor({
        content: p.value || EMPTY_DOC,
        editable: isEditorEditable(initialMode, p.readonly ?? false),
        extensions: [
          StarterKit.configure(resolveStarterKitOptions(initialFeatures)),
          createTrackChangesExtension({
            suggesting: initialMode === 'suggesting',
            authorId: p.authorId ?? null,
          }),
          ...featureExtensions(initialFeatures),
          ...(p.extraExtensions ?? []),
        ],
        onUpdate: ({ editor: ed }) => {
          const next = serializeEditor(ed, latest.current.format ?? 'json');
          hydrationGuard.markLocalChange(next);
          latest.current.onChange?.(next);
        },
      });
      instance.on('transaction', rerender);
      setEditor(instance);
      p.onReady?.(instance);
      return () => {
        instance.off('transaction', rerender);
        instance.destroy();
        setEditor(null);
      };
    }, [hydrationGuard]);

    const commands = useMemo(() => createEditorCommands(() => editor), [editor]);

    useEffect(() => {
      if (!editor) return;
      const editable = isEditorEditable(mode, readonly);
      if (editor.isEditable !== editable) editor.setEditable(editable);
      if (getTrackChangesState(editor.state).suggesting !== (mode === 'suggesting')) {
        commands.setSuggesting(mode === 'suggesting');
      }
    }, [editor, commands, mode, readonly]);

    useEffect(() => {
      if (editor) setEditorUploadHandler(editor, uploadHandler);
    }, [editor, uploadHandler]);

    useEffect(() => {
      if (!editor || getTrackChangesState(editor.state).authorId === authorId) return;
      setSuggestionAuthor(authorId)(editor.state, (tr) => editor.view.dispatch(tr));
    }, [editor, authorId]);

    useEffect(() => {
      if (!editor || !hydrationGuard.shouldHydrate(value)) return;
      // Only reachable before local editing, so replacing the initial empty
      // document cannot discard selection/history/suggestions.
      // `emitUpdate: false` prevents a hydration feedback loop.
      editor.commands.setContent(value || EMPTY_DOC, false);
    }, [editor, hydrationGuard, value]);

    useImperativeHandle(ref, () => ({ editor, ...commands }), [editor, commands]);

    const rootClass = className ? `tc-editor ${className}` : 'tc-editor';
    if (!editor) return <div className={rootClass} />;

    const items = isToolbarVisible(mode, readonly) ? featureToolbarItems(features) : [];
    const ctx: EditorFeatureContext = { editor, upload: uploadHandler };
    const count = isCharacterCountVisible(props) ? characterCountView(editor.state.doc, props) : null;

    return (
      <div className={rootClass}>
        {items.length > 0 && (
          <div className="tc-toolbar" role="toolbar">
            {items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={
                  item.isActive?.(ctx) ? 'tc-toolbar-btn tc-toolbar-btn--active' : 'tc-toolbar-btn'
                }
                disabled={item.isEnabled ? !item.isEnabled(ctx) : false}
                title={item.label}
                aria-label={item.label}
                onClick={() => void item.run(ctx)}
              >
                {item.text}
              </button>
            ))}
          </div>
        )}
        <EditorContent editor={editor} />
        {count && (
          <div
            className={count.over ? 'tc-charcount tc-charcount--over' : 'tc-charcount'}
            role="status"
            aria-live="polite"
          >
            <span
              className={
                count.charsOver ? 'tc-charcount-chars tc-charcount-part--over' : 'tc-charcount-chars'
              }
            >
              {count.charText}
            </span>
            <span
              className={
                count.wordsOver ? 'tc-charcount-words tc-charcount-part--over' : 'tc-charcount-words'
              }
            >
              {` · ${count.wordText}`}
            </span>
          </div>
        )}
      </div>
    );
  },
);
