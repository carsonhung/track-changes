import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';

export interface TrackChangesState {
  /** When true, edits are recorded as suggestions instead of applied directly. */
  suggesting: boolean;
  /** Author attributed to new suggestions. */
  authorId: string | null;
}

export interface TrackChangesStateOptions {
  /** Start in suggesting mode. */
  suggesting?: boolean;
  /** Author attributed to new suggestions. */
  authorId?: string | null;
}

export const trackChangesKey = new PluginKey<TrackChangesState>('trackChanges');

export const DEFAULT_TC_STATE: TrackChangesState = { suggesting: false, authorId: null };

export function getTrackChangesState(state: EditorState): TrackChangesState {
  return trackChangesKey.getState(state) ?? DEFAULT_TC_STATE;
}

/** Whether suggesting mode is currently active. */
export function isSuggesting(state: EditorState): boolean {
  return getTrackChangesState(state).suggesting;
}

/**
 * The state plugin — the single owner of the mode/author `TrackChangesState`
 * under `trackChangesKey`, toggled via `setMeta(trackChangesKey, ...)` (see the
 * `setSuggesting` / `setSuggestionAuthor` commands).
 *
 * Feature plugins (text input, clipboard, future node/table integrations) are
 * deliberately separate, stateless plugins that *read* this state — the same
 * composition CKEditor 5 uses (a core editing plugin that feature integrations
 * plug into). This plugin must be installed for any of them to activate.
 */
export function createTrackChangesStatePlugin(
  options: TrackChangesStateOptions = {},
): Plugin<TrackChangesState> {
  return new Plugin<TrackChangesState>({
    key: trackChangesKey,
    state: {
      init: () => ({ suggesting: options.suggesting ?? false, authorId: options.authorId ?? null }),
      apply: (tr, value) => {
        const meta = tr.getMeta(trackChangesKey) as Partial<TrackChangesState> | undefined;
        return meta ? { ...value, ...meta } : value;
      },
    },
  });
}
