export { default as TrackChangesEditor } from './TrackChangesEditor';
export type { EditorMode, EditorFormat, TrackChangesEditorApi } from './TrackChangesEditor';
export type { SuggestionSummary } from 'track-changes-core';

export { useTrackChangesReview } from './useTrackChangesReview';
export type { UseTrackChangesReview, TrackChangesEditorLike } from './useTrackChangesReview';

// Feature plugins live in the framework-agnostic core (shared with the React
// and vanilla adapters); re-exported so existing imports keep working.
export type {
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
