import { Node, mergeAttributes } from '@tiptap/core';
import { NodeSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/vue-3';
import type { EditorFeature } from './types';
import { featureInsertNode, featureDeleteNode, pickFile } from './featureCommands';

/**
 * Image upload feature (CKEditor `ImageUpload`-equivalent):
 *
 * - registers a minimal inline atom `image` node (tracked via the core's
 *   insertion/deletion *marks*, like any inline atom — no extra integration)
 * - "Insert image" toolbar button → file picker → the host's `upload(file)`
 *   handler → the resolved `src` is inserted as a tracked insertion when
 *   suggesting (plain insert when editing)
 * - "Remove image" suggests deletion of the image at/under the selection
 *
 * The package owns no upload transport: the host passes `uploadHandler` to
 * `<TrackChangesEditor>` (e.g. an attachments-API adapter or a data-URL stub).
 * The button is disabled when no handler is provided.
 */

export const TrackedImage = Node.create({
  name: 'image',
  group: 'inline',
  inline: true,
  atom: true,
  draggable: true,
  addAttributes() {
    return {
      src: { default: '' },
      alt: { default: '' },
    };
  },
  parseHTML() {
    return [{ tag: 'img[src]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['img', mergeAttributes({ class: 'tc-img' }, HTMLAttributes)];
  },
});

/** Position of the image at/under the current selection, or -1. */
function selectedImagePos(editor: Editor): number {
  const sel = editor.state.selection;
  if (sel instanceof NodeSelection && sel.node.type.name === 'image') return sel.from;
  let pos = -1;
  editor.state.doc.nodesBetween(sel.from, sel.to, (node, p) => {
    if (pos < 0 && node.type.name === 'image') pos = p;
    return pos < 0;
  });
  return pos;
}

export interface ImageUploadFeatureLabels {
  insertImage: string;
  removeImage: string;
}

export interface ImageUploadFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<ImageUploadFeatureLabels>;
  /** File-picker accept filter. */
  accept?: string;
}

export function createImageUploadFeature(options: ImageUploadFeatureOptions = {}): EditorFeature {
  const labels: ImageUploadFeatureLabels = {
    insertImage: 'Insert image',
    removeImage: 'Remove image',
    ...options.labels,
  };
  const accept = options.accept ?? 'image/*';

  return {
    name: 'imageUpload',
    extensions: () => [TrackedImage],
    toolbarItems: () => [
      {
        id: 'image.insert',
        label: labels.insertImage,
        text: labels.insertImage,
        isEnabled: ({ upload }) => upload != null,
        run: async ({ editor, upload }) => {
          if (!upload) return;
          const file = await pickFile(accept);
          if (!file) return;
          const result = await upload(file);
          const node = editor.state.schema.nodes.image.create({
            src: result.src,
            alt: result.alt ?? file.name,
          });
          featureInsertNode(editor, node);
        },
      },
      {
        id: 'image.remove',
        label: labels.removeImage,
        text: labels.removeImage,
        isEnabled: ({ editor }) => selectedImagePos(editor) >= 0,
        run: ({ editor }) => {
          const pos = selectedImagePos(editor);
          if (pos >= 0) featureDeleteNode(editor, pos);
        },
      },
    ],
  };
}
