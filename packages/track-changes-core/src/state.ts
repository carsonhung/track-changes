import { PluginKey, type EditorState } from '@tiptap/pm/state';

export interface TrackChangesState {
  /** When true, edits are recorded as suggestions instead of applied directly. */
  suggesting: boolean;
  /** Author attributed to new suggestions. */
  authorId: string | null;
}

export const trackChangesKey = new PluginKey<TrackChangesState>('trackChanges');

export const DEFAULT_TC_STATE: TrackChangesState = { suggesting: false, authorId: null };

export function getTrackChangesState(state: EditorState): TrackChangesState {
  return trackChangesKey.getState(state) ?? DEFAULT_TC_STATE;
}
