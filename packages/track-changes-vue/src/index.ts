export { default as TrackChangesEditor } from './TrackChangesEditor';
export type { EditorMode, EditorFormat, TrackChangesEditorApi } from './TrackChangesEditor';
export type { SuggestionSummary } from 'track-changes-core';

export { useTrackChangesReview } from './useTrackChangesReview';
export type { UseTrackChangesReview, TrackChangesEditorLike } from './useTrackChangesReview';

export type {
  EditorFeature,
  EditorFeatureContext,
  EditorToolbarItem,
  EditorUploadHandler,
  EditorUploadResult,
  EditorUrlIngestHandler,
} from './features/types';
export { featureInsertNode, featureDeleteNode, pickFile } from './features/featureCommands';
export {
  createImageUploadFeature,
  TrackedImage,
  type ImageUploadFeatureOptions,
  type ImageUploadFeatureLabels,
  type ImagePasteEvent,
  type ImagePasteStatus,
} from './features/imageUpload';
export {
  createTableFeature,
  TrackedTable,
  TrackedTableRow,
  TrackedTableCell,
  TrackedTableHeaderCell,
  type TableFeatureOptions,
  type TableFeatureLabels,
} from './features/table';
export {
  createFormattingFeature,
  type FormattingFeatureOptions,
  type FormattingFeatureLabels,
} from './features/formatting';
export {
  createLinkFeature,
  TrackedLink,
  normalizeLinkHref,
  type LinkFeatureOptions,
  type LinkFeatureLabels,
} from './features/link';

export { VERSION } from './version';
