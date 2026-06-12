// @tdg-reports/track-changes-core — headless suggesting-mode engine (Phase 1).
//
// Keystone rule: every suggestion is document data (marks carrying
// { id, authorId, ts }), never plugin state / decorations — so suggestions
// serialize, print, and (later) sync over Yjs without redesign.

export { INSERTION, DELETION, insertionMarkSpec, deletionMarkSpec, insertionType, deletionType } from './marks';
export type { SuggestionAttrs, SuggestionType } from './marks';

export {
  SUGGESTION_NODE_ATTR,
  suggestionNodeAttrSpec,
  isTrackableNode,
  readNodeSuggestion,
  suggestionToDomAttrs,
  suggestionFromDom,
} from './nodeAttrs';
export type { NodeSuggestion } from './nodeAttrs';

export { createSuggestionId } from './ids';

export { trackChangesKey, getTrackChangesState, DEFAULT_TC_STATE } from './state';
export type { TrackChangesState } from './state';

export {
  acceptOn,
  rejectOn,
  acceptAllOn,
  rejectAllOn,
  toClean,
  toRejected,
  toTracked,
  listSuggestions,
  hasSuggestions,
} from './clean';
export type { SuggestionSummary, SuggestionRange } from './clean';

export {
  setSuggesting,
  setSuggestionAuthor,
  suggestInsertText,
  suggestInsertTextAt,
  suggestDeleteBackward,
  suggestDeleteForward,
  suggestInsertNode,
  suggestDeleteNode,
  acceptSuggestion,
  rejectSuggestion,
  acceptAllSuggestions,
  rejectAllSuggestions,
} from './commands';

export { createSuggestingPlugin } from './plugin';
export type { SuggestingOptions } from './plugin';

export { TrackChanges, InsertionMark, DeletionMark, createTrackChangesExtension, suggestionNodeAttributes } from './tiptap';
export type { TrackChangesExtensionOptions } from './tiptap';

export { withSuggestionMarks, createBasicSuggestionSchema, createExtendedSuggestionSchema } from './schema';

export { VERSION } from './version';
