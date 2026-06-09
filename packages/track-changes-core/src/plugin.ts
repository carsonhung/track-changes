import { Plugin, type Transaction } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { trackChangesKey, type TrackChangesState } from './state';
import { suggestInsertTextAt, suggestDeleteBackward, suggestDeleteForward } from './commands';

export interface SuggestingOptions {
  /** Start in suggesting mode. */
  suggesting?: boolean;
  /** Author attributed to new suggestions. */
  authorId?: string | null;
}

/**
 * The suggesting-mode plugin. Holds the mode/author in plugin state (toggled via
 * `setMeta(trackChangesKey, ...)`), and routes text input + Backspace/Delete to
 * the suggestion commands when active. All document mutation goes through the
 * commands, which encode changes as marks (never plugin decorations).
 */
export function createSuggestingPlugin(options: SuggestingOptions = {}): Plugin<TrackChangesState> {
  return new Plugin<TrackChangesState>({
    key: trackChangesKey,
    state: {
      init: () => ({ suggesting: options.suggesting ?? false, authorId: options.authorId ?? null }),
      apply: (tr, value) => {
        const meta = tr.getMeta(trackChangesKey) as Partial<TrackChangesState> | undefined;
        return meta ? { ...value, ...meta } : value;
      },
    },
    props: {
      handleTextInput(view: EditorView, from: number, to: number, text: string) {
        if (!trackChangesKey.getState(view.state)?.suggesting) return false;
        return suggestInsertTextAt(from, to, text)(view.state, (tr) => view.dispatch(tr));
      },
      handleKeyDown(view: EditorView, event: KeyboardEvent) {
        if (!trackChangesKey.getState(view.state)?.suggesting) return false;
        const dispatch = (tr: Transaction) => view.dispatch(tr);
        if (event.key === 'Backspace') return suggestDeleteBackward(view.state, dispatch);
        if (event.key === 'Delete') return suggestDeleteForward(view.state, dispatch);
        return false;
      },
    },
  });
}
