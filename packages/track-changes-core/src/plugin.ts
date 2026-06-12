import { Plugin, PluginKey, type Transaction } from '@tiptap/pm/state';
import type { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import {
  createTrackChangesStatePlugin,
  isSuggesting,
  type TrackChangesStateOptions,
} from './state';
import { suggestInsertTextAt, suggestDeleteBackward, suggestDeleteForward } from './commands';

/**
 * Suggesting mode is composed CKEditor-style: one state-owning core plugin
 * (`createTrackChangesStatePlugin`) plus small, stateless feature plugins that
 * each cover one input surface and read the shared state. Hosts can compose
 * exactly the features they need, and new surfaces (tables UI, atom toolbars,
 * future IME/structural interception) arrive as additional plugins without
 * touching the existing ones.
 *
 * | Plugin | Surface | Tracked as |
 * |---|---|---|
 * | `createTextSuggestingPlugin` | typing, Backspace/Delete | insertion / deletion marks |
 * | `createClipboardSuggestingPlugin` | paste, cut | tracked insert of pasted text; cut becomes a tracked deletion |
 *
 * Known limitation: IME composition and structural edits (e.g. Enter splitting
 * a paragraph) bypass editor props and apply untracked. Intercepting them needs
 * transaction rewriting (`appendTransaction`) — planned as another feature
 * plugin; see the architecture doc.
 */

/** Back-compat alias; options simply seed the state plugin. */
export type SuggestingOptions = TrackChangesStateOptions;

export const textSuggestingKey = new PluginKey('trackChangesText');
export const clipboardSuggestingKey = new PluginKey('trackChangesClipboard');

/**
 * Plain-text projection of a pasted slice. Block boundaries become newlines
 * (rendered by the editor's `white-space: pre-wrap`), leaf atoms a space.
 * Exported for tests and custom clipboard integrations.
 */
export function sliceText(slice: Slice): string {
  return slice.content.textBetween(0, slice.content.size, '\n', ' ');
}

/**
 * Text-input feature plugin: typed text becomes a tracked insertion;
 * Backspace/Delete become tracked deletions (text kept, deletion-marked).
 */
export function createTextSuggestingPlugin(): Plugin {
  return new Plugin({
    key: textSuggestingKey,
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (!isSuggesting(view.state)) return false;
        return suggestInsertTextAt(from, to, text)(view.state, (tr) => view.dispatch(tr));
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        if (!isSuggesting(view.state)) return false;
        const dispatch = (tr: Transaction) => view.dispatch(tr);
        if (event.key === 'Backspace') return suggestDeleteBackward(view.state, dispatch);
        if (event.key === 'Delete') return suggestDeleteForward(view.state, dispatch);
        return false;
      },
    },
  });
}

/**
 * Clipboard feature plugin:
 * - paste → tracked insertion of the slice's text (rich/structural pastes are
 *   flattened to text; a slice with no text is blocked rather than applied
 *   untracked)
 * - cut → the clipboard is written manually, then the selection becomes a
 *   tracked deletion (the text stays in the document, deletion-marked)
 */
export function createClipboardSuggestingPlugin(): Plugin {
  return new Plugin({
    key: clipboardSuggestingKey,
    props: {
      handlePaste(view: EditorView, _event: ClipboardEvent, slice: Slice) {
        if (!isSuggesting(view.state)) return false;
        const text = sliceText(slice);
        // No text to track (e.g. a lone image slice): swallow the paste instead
        // of letting it apply untracked.
        if (!text) return true;
        const { from, to } = view.state.selection;
        return suggestInsertTextAt(from, to, text)(view.state, (tr) => view.dispatch(tr));
      },
      handleDOMEvents: {
        cut(view: EditorView, event: ClipboardEvent) {
          if (!isSuggesting(view.state)) return false;
          const { empty, from, to } = view.state.selection;
          if (empty) return false;
          event.clipboardData?.setData(
            'text/plain',
            view.state.doc.textBetween(from, to, '\n', ' '),
          );
          event.preventDefault();
          suggestDeleteBackward(view.state, (tr) => view.dispatch(tr));
          return true;
        },
      },
    },
  });
}

/**
 * The full suggesting-mode plugin set: state core + every input feature plugin.
 * Spread into `EditorState.create({ plugins: [...] })` for raw ProseMirror, or
 * use the Tiptap `TrackChanges` extension which composes the same set.
 */
export function createSuggestingPlugins(options: SuggestingOptions = {}): Plugin[] {
  return [
    createTrackChangesStatePlugin(options),
    createTextSuggestingPlugin(),
    createClipboardSuggestingPlugin(),
  ];
}
