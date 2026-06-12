export { default as TrackChangesEditor } from './TrackChangesEditor';
export type { EditorMode, TrackChangesEditorApi } from './TrackChangesEditor';
export type { SuggestionSummary } from '@tdg-reports/track-changes-core';

export { useTrackChangesReview } from './useTrackChangesReview';
export type { UseTrackChangesReview, TrackChangesEditorLike } from './useTrackChangesReview';

export type {
  EditorFeature,
  EditorFeatureContext,
  EditorToolbarItem,
  EditorUploadHandler,
  EditorUploadResult,
} from './features/types';
export { featureInsertNode, featureDeleteNode, pickFile } from './features/featureCommands';
export {
  createImageUploadFeature,
  TrackedImage,
  type ImageUploadFeatureOptions,
  type ImageUploadFeatureLabels,
} from './features/imageUpload';
export {
  createTableFeature,
  TrackedTable,
  TrackedTableRow,
  TrackedTableCell,
  type TableFeatureOptions,
  type TableFeatureLabels,
} from './features/table';

export { VERSION } from './version';
