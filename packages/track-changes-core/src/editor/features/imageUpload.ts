import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
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
 * - **image-link paste**: pasting a bare image or cloud-storage link ingests
 *   it and inserts the image — see `createImageLinkPasteExtension` below
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
  /**
   * `image` — an external image node (pasted/dropped markup); on `rejected`
   * it was removed. `link` — a pasted bare URL; on `rejected` the URL was
   * pasted as plain text instead.
   */
  source: 'image' | 'link';
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
                urls.forEach((url) => onEvent?.({ status: 'stripped', url, source: 'image' }));
                return;
              }

              for (const url of new Set(found.map((f) => f.src))) {
                if (inflight.has(url)) continue;
                inflight.add(url);
                ingest(url)
                  .then((result) => {
                    swapImageSrc(view, url, result);
                    onEvent?.({ status: 'ingested', url, source: 'image' });
                  })
                  .catch(() => {
                    removeImagesBySrc(view, url);
                    onEvent?.({ status: 'rejected', url, source: 'image' });
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

// ---------------------------------------------------------------------------
// Image-link paste
//
// Pasting a bare URL that points at an image or a cloud-storage share link
// (Google Drive, OneDrive, Dropbox, …) inserts the *image*, not the link text.
// The URL goes through the same `ingestUrl` host handler as pasted hotlinks,
// so it is copied into platform storage first; turning a share-page URL into
// the actual file (and rejecting non-images) is the host backend's job. On
// failure the URL is pasted as plain text, i.e. the paste the user would have
// got anyway.
//
// While ingestion runs, an "Importing image…" widget decoration marks the
// insertion point; decorations map through concurrent edits, so the image
// lands where the user pasted even if they kept typing.
// ---------------------------------------------------------------------------

const IMAGE_PATH = /\.(png|jpe?g|gif|webp|avif|svg|bmp|heic)$/i;
const IMAGE_LINK_HOSTS = [
  'drive.google.com',
  'googleusercontent.com',
  'onedrive.live.com',
  '1drv.ms',
  'sharepoint.com',
  'dropbox.com',
  'dropboxusercontent.com',
  'icloud.com',
  'imgur.com',
];

/**
 * Default `pasteImageLinks` predicate: an `http(s)` URL whose path ends in an
 * image extension, or any link on a common cloud-storage / image host.
 */
export function isLikelyImageLink(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (IMAGE_PATH.test(parsed.pathname)) return true;
  const host = parsed.hostname.toLowerCase();
  return IMAGE_LINK_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

const BARE_URL = /^https?:\/\/\S+$/i;

type LinkPasteMeta = { add: { id: object; pos: number } } | { remove: { id: object } };

export const imageLinkPasteKey = new PluginKey<DecorationSet>('tcImageLinkPaste');

function createImageLinkPasteExtension(
  ingest: EditorUrlIngestHandler,
  matches: (url: string) => boolean,
  pendingLabel: string,
  onEvent?: (event: ImagePasteEvent) => void,
) {
  return Extension.create({
    name: 'imageLinkPaste',
    // Must see the paste before the track-changes clipboard plugin, which
    // claims every paste while suggesting.
    priority: 1000,
    addProseMirrorPlugins() {
      const editor = this.editor;

      const placeholderPos = (view: EditorView, id: object): number | null => {
        const set = imageLinkPasteKey.getState(view.state);
        const found = set?.find(undefined, undefined, (spec) => spec.id === id) ?? [];
        return found.length ? found[0].from : null;
      };

      return [
        new Plugin<DecorationSet>({
          key: imageLinkPasteKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
              let next = set.map(tr.mapping, tr.doc);
              const meta = tr.getMeta(imageLinkPasteKey) as LinkPasteMeta | undefined;
              if (meta && 'add' in meta) {
                const widget = Decoration.widget(
                  meta.add.pos,
                  (view) => {
                    const el = view.dom.ownerDocument.createElement('span');
                    el.className = 'tc-img-pending';
                    el.textContent = pendingLabel;
                    return el;
                  },
                  { id: meta.add.id },
                );
                next = next.add(tr.doc, [widget]);
              } else if (meta && 'remove' in meta) {
                next = next.remove(next.find(undefined, undefined, (spec) => spec.id === meta.remove.id));
              }
              return next;
            },
          },
          props: {
            decorations: (state) => imageLinkPasteKey.getState(state),
            handlePaste(view, event) {
              const data = event.clipboardData;
              if (!data) return false;
              // Real image markup is the localizer's job.
              if (/<img[\s>]/i.test(data.getData('text/html'))) return false;
              const url = data.getData('text/plain').trim();
              if (!BARE_URL.test(url) || !matches(url)) return false;

              const id = {};
              // Untagged on purpose: while suggesting, replacing a selection
              // becomes a tracked deletion via the rewrite plugin.
              const tr = view.state.tr.deleteSelection();
              view.dispatch(tr.setMeta(imageLinkPasteKey, { add: { id, pos: tr.selection.from } }));

              const settle = (apply: (pos: number) => void) => {
                if (editor.isDestroyed) return;
                const pos = placeholderPos(view, id);
                view.dispatch(view.state.tr.setMeta(imageLinkPasteKey, { remove: { id } }));
                if (pos !== null) apply(pos);
              };

              ingest(url)
                .then((result) => {
                  settle((pos) => {
                    const node = view.state.schema.nodes.image.create({
                      src: result.src,
                      alt: result.alt ?? '',
                    });
                    featureInsertNode(editor, node, pos);
                  });
                  onEvent?.({ status: 'ingested', url, source: 'link' });
                })
                .catch(() => {
                  // Plain (untagged) insert: tracked while suggesting, like typing.
                  settle((pos) => view.dispatch(view.state.tr.insertText(url, pos)));
                  onEvent?.({ status: 'rejected', url, source: 'link' });
                });
              return true;
            },
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
  /** Placeholder shown while a pasted image link is being imported. */
  importingImage: string;
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
  /** Notified whenever an external image or pasted image link is ingested / rejected / stripped. */
  onImagePaste?: (event: ImagePasteEvent) => void;
  /**
   * Pasting a bare image or cloud-storage link (e.g. `https://…/photo.png`,
   * a Google Drive / OneDrive / Dropbox share link) imports it through
   * `ingestUrl` and inserts the image; if ingestion fails, the URL is pasted
   * as plain text. Default `true` (using `isLikelyImageLink`) — pass your own
   * predicate to decide which links to try, or `false` to always paste links
   * as text. Has no effect without `ingestUrl`.
   */
  pasteImageLinks?: boolean | ((url: string) => boolean);
}

export function createImageUploadFeature(options: ImageUploadFeatureOptions = {}): EditorFeature {
  const labels: ImageUploadFeatureLabels = {
    insertImage: 'Insert image',
    removeImage: 'Remove image',
    importingImage: 'Importing image\u2026',
    ...options.labels,
  };
  const accept = options.accept ?? 'image/*';
  const ingestUrl = options.ingestUrl ?? null;
  const pasteImageLinks = options.pasteImageLinks ?? true;
  const linkMatcher =
    typeof pasteImageLinks === 'function' ? pasteImageLinks : pasteImageLinks ? isLikelyImageLink : null;

  return {
    name: 'imageUpload',
    extensions: () => [
      TrackedImage,
      createImageLocalizerExtension(ingestUrl, options.onImagePaste),
      ...(ingestUrl && linkMatcher
        ? [
            createImageLinkPasteExtension(
              ingestUrl,
              linkMatcher,
              labels.importingImage,
              options.onImagePaste,
            ),
          ]
        : []),
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
