import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { tagSuggestionTx } from '../../rewrite';
import type { EditorFeature, EditorUrlIngestHandler } from './types';
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
 * - **external-image localization**: images whose `src` points at a remote
 *   `http(s)` host (typically pasted from a web page or cloud document) are
 *   never left as hotlinks — see `createImageLocalizerExtension` below
 *
 * The package owns no upload transport: the host passes `uploadHandler` to
 * the editor (e.g. an attachments-API adapter or a data-URL stub).
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

// ---------------------------------------------------------------------------
// External-image localization ("cloud image" paste handling)
//
// Hotlinked images are a liability in archived documents: cloud-doc URLs are
// usually auth-gated and expire, the remote content can change after review,
// and every render pings a third-party host. So external `http(s)` srcs are
// reconciled away the moment they appear in an editable document:
//
// - with an `ingestUrl` handler: the host takes a copy into platform storage
//   and the node's `src` is swapped to the local result; if ingestion fails
//   the image is removed (never silently kept as a hotlink)
// - without a handler: the image is stripped immediately
//
// A doc-scan reconciler (rather than a paste hook) also catches drag-and-drop
// and programmatic inserts. Read-only views are left untouched, so legacy
// content still renders.
// ---------------------------------------------------------------------------

export type ImagePasteStatus = 'ingested' | 'rejected' | 'stripped';

export interface ImagePasteEvent {
  status: ImagePasteStatus;
  url: string;
}

const isExternalSrc = (src: unknown): src is string =>
  typeof src === 'string' && /^https?:\/\//i.test(src);

function externalImages(view: EditorView): Array<{ pos: number; src: string }> {
  const found: Array<{ pos: number; src: string }> = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && isExternalSrc(node.attrs.src)) {
      found.push({ pos, src: node.attrs.src });
    }
    return undefined;
  });
  return found;
}

/** Delete every image node whose src matches, in one tagged transaction. */
function removeImagesBySrc(view: EditorView, src: string): void {
  const targets: Array<{ pos: number; size: number }> = [];
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src === src) {
      targets.push({ pos, size: node.nodeSize });
    }
    return undefined;
  });
  if (!targets.length) return;
  const tr = view.state.tr;
  targets.sort((a, b) => b.pos - a.pos).forEach((t) => tr.delete(t.pos, t.pos + t.size));
  // Tagged: removing a failed import must be a real removal, not a tracked
  // deletion the rewrite plugin would restore as struck-out content.
  view.dispatch(tagSuggestionTx(tr));
}

/** Swap the src of every image node matching `src`, preserving marks. */
function swapImageSrc(view: EditorView, src: string, next: { src: string; alt?: string }): void {
  const tr = view.state.tr;
  let changed = false;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src === src) {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        src: next.src,
        alt: next.alt ?? node.attrs.alt,
      });
      changed = true;
    }
    return undefined;
  });
  if (changed) view.dispatch(tagSuggestionTx(tr));
}

function createImageLocalizerExtension(
  ingest: EditorUrlIngestHandler | null,
  onEvent?: (event: ImagePasteEvent) => void,
) {
  return Extension.create({
    name: 'imageLocalizer',
    addProseMirrorPlugins() {
      const inflight = new Set<string>();
      return [
        new Plugin({
          key: new PluginKey('tcImageLocalizer'),
          view: (view) => {
            const process = () => {
              if (!view.editable) return;
              const found = externalImages(view);
              if (!found.length) return;

              if (!ingest) {
                const urls = [...new Set(found.map((f) => f.src))];
                urls.forEach((url) => removeImagesBySrc(view, url));
                urls.forEach((url) => onEvent?.({ status: 'stripped', url }));
                return;
              }

              for (const url of new Set(found.map((f) => f.src))) {
                if (inflight.has(url)) continue;
                inflight.add(url);
                ingest(url)
                  .then((result) => {
                    swapImageSrc(view, url, result);
                    onEvent?.({ status: 'ingested', url });
                  })
                  .catch(() => {
                    removeImagesBySrc(view, url);
                    onEvent?.({ status: 'rejected', url });
                  })
                  .finally(() => inflight.delete(url));
              }
            };
            // Defer the initial pass: dispatching during view construction is
            // unsafe, and loaded legacy content deserves the same treatment.
            queueMicrotask(process);
            return { update: process };
          },
        }),
      ];
    },
  });
}

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
  /**
   * Localizes externally-hosted images (pasted hotlinks) by taking a copy
   * into platform storage. Without a handler, external images are stripped
   * on paste instead — they are never kept as hotlinks either way.
   */
  ingestUrl?: EditorUrlIngestHandler | null;
  /** Notified whenever an external image is ingested / rejected / stripped. */
  onImagePaste?: (event: ImagePasteEvent) => void;
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
    extensions: () => [
      TrackedImage,
      createImageLocalizerExtension(options.ingestUrl ?? null, options.onImagePaste),
    ],
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
