export { TrackChangesEditor } from './TrackChangesEditor';
export type {
  EditorMode,
  EditorFormat,
  TrackChangesEditorProps,
  TrackChangesEditorRef,
} from './TrackChangesEditor';
export type { SuggestionSummary } from 'track-changes-core';

export { useTrackChangesReview } from './useTrackChangesReview';
export type { UseTrackChangesReview } from './useTrackChangesReview';

// Feature plugins are framework-agnostic and live in the core; re-exported
// so a React app needs a single import site.
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
