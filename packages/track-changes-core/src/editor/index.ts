export {
  EMPTY_DOC,
  RESTRICTED_STARTER_KIT,
  resolveStarterKitOptions,
  featureExtensions,
  featureToolbarItems,
  isEditorEditable,
  isToolbarVisible,
  serializeEditor,
  createEditorCommands,
  isCharacterCountVisible,
  characterCountView,
  createSuggestionReview,
} from './editorKit';
export type {
  EditorMode,
  EditorFormat,
  TrackChangesEditorCommands,
  CharacterCountLimits,
  CharacterCountView,
  SuggestionReview,
} from './editorKit';

export { createModelHydrationGuard } from './modelHydration';
export type { EditorModelValue } from './modelHydration';

export type {
  EditorFeature,
  EditorFeatureContext,
  EditorToolbarItem,
  EditorUploadHandler,
  EditorUploadResult,
  EditorUrlIngestHandler,
} from './features/types';
export {
  featureInsertNode,
  featureInsertNodes,
  featureDeleteNode,
  featureDeleteNodes,
  setEditorUploadHandler,
  getEditorUploadHandler,
  pickFile,
} from './features/featureCommands';
export {
  createImageUploadFeature,
  TrackedImage,
  isLikelyImageLink,
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
