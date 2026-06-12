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

export {
  trackChangesKey,
  getTrackChangesState,
  isSuggesting,
  DEFAULT_TC_STATE,
  createTrackChangesStatePlugin,
} from './state';
export type { TrackChangesState, TrackChangesStateOptions } from './state';

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

export {
  createSuggestingPlugins,
  createTextSuggestingPlugin,
  createClipboardSuggestingPlugin,
  textSuggestingKey,
  clipboardSuggestingKey,
  sliceText,
} from './plugin';
export type { SuggestingOptions } from './plugin';

export {
  SUGGESTION_TX_META,
  tagSuggestionTx,
  isRewriteExempt,
  createRewriteSuggestingPlugin,
  rewriteSuggestingKey,
} from './rewrite';

export {
  TrackChanges,
  TrackChangesCore,
  TrackChangesText,
  TrackChangesClipboard,
  TrackChangesRewrite,
  InsertionMark,
  DeletionMark,
  createTrackChangesExtension,
  suggestionNodeAttributes,
  trackableNode,
} from './tiptap';
export type { TrackChangesExtensionOptions } from './tiptap';

export { withSuggestionMarks, createBasicSuggestionSchema, createExtendedSuggestionSchema } from './schema';

export { VERSION } from './version';
