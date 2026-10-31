export { createTrackChangesEditor } from './createTrackChangesEditor';
export type {
  TrackChangesEditorOptions,
  TrackChangesEditorHandle,
} from './createTrackChangesEditor';

// Framework-agnostic pieces from the core, re-exported so a vanilla app
// needs a single import site.
export type {
  EditorMode,
  EditorFormat,
  SuggestionSummary,
  SuggestionReview,
  EditorFeature,
  EditorFeatureContext,
  EditorToolbarItem,
  EditorUploadHandler,
  EditorUploadResult,
  EditorUrlIngestHandler,
  ImageUploadFeatureOptions,
  ImageUploadFeatureLabels,
  ImagePasteEvent,
  ImagePasteStatus,
  TableFeatureOptions,
  TableFeatureLabels,
  FormattingFeatureOptions,
  FormattingFeatureLabels,
  LinkFeatureOptions,
  LinkFeatureLabels,
} from 'track-changes-core';
export {
  createSuggestionReview,
  featureInsertNode,
  featureDeleteNode,
  pickFile,
  createImageUploadFeature,
  TrackedImage,
  isLikelyImageLink,
  createTableFeature,
  TrackedTable,
  TrackedTableRow,
  TrackedTableCell,
  TrackedTableHeaderCell,
  createFormattingFeature,
  createLinkFeature,
  TrackedLink,
  normalizeLinkHref,
} from 'track-changes-core';

export { VERSION } from './version';
