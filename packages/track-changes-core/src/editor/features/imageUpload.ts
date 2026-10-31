import { Node, Extension, mergeAttributes } from '@tiptap/core';
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Editor } from '@tiptap/core';
import { tagSuggestionTx } from '../../rewrite';
import type { EditorFeature, EditorUploadResult, EditorUrlIngestHandler } from './types';
import {
  featureInsertNode,
  featureDeleteNode,
  getEditorUploadHandler,
  pickFile,
} from './featureCommands';

/**
 * Image upload feature (CKEditor `ImageUpload`-equivalent):
 *
 * - registers a minimal inline atom `image` node (tracked via the core's
 *   insertion/deletion *marks*, like any inline atom — no extra integration)
 * - "Insert image" toolbar button → file picker → the host's `upload(file)`
 *   handler → the resolved `src` is inserted as a tracked insertion when
 *   suggesting (plain insert when editing)
 * - "Remove image" suggests deletion of the image at/under the selection
 * - **every image ends up in platform storage**: pasted/dropped image files
 *   are uploaded, pasted image/cloud links and external image markup are
 *   ingested (copied), so no document ever depends on a third-party file
 *   that its owner can move, re-permission, or delete
 *
 * The package owns no storage transport: the host passes `uploadHandler` to
 * the editor and `ingestUrl` to this feature. "Local" means a `src` the
 * platform owns: anything that isn't `http(s)`, plus `localImageOrigins`
 * (e.g. your bucket/CDN) and `isLocalImageSrc`.
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

export type ImagePasteStatus = 'ingested' | 'uploaded' | 'rejected' | 'stripped';

export interface ImagePasteEvent {
  status: ImagePasteStatus;
  /** The external URL, or the file name for `source: 'file'`. */
  url: string;
  /**
   * `image` — an external image node (pasted/dropped markup); on `rejected`
   * it was removed. `link` — a pasted bare URL; on `rejected` the URL was
   * pasted as plain text instead. `file` — a pasted/dropped image file; on
   * `rejected` nothing was inserted.
   */
  source: 'image' | 'link' | 'file';
}

type SrcCheck = (src: string) => boolean;

const isHttp = (src: string) => /^https?:\/\//i.test(src);

function createLocalSrcCheck(origins: readonly string[], custom?: SrcCheck): SrcCheck {
  const allowed = new Set(origins.map((o) => new URL(o).origin));
  return (src) => {
    if (!isHttp(src)) return true;
    if (custom?.(src)) return true;
    try {
      return allowed.has(new URL(src).origin);
    } catch {
      return false;
    }
  };
}

// ---------------------------------------------------------------------------
// External-image localization ("cloud image" paste handling)
//
// Hotlinked images are a liability in archived documents: the owner can
// delete or re-permission the original, cloud-doc URLs are usually
// auth-gated and expire, the remote content can change after review, and
// every render pings a third-party host. So non-local `http(s)` srcs are
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

function externalImages(view: EditorView, isLocal: SrcCheck): Array<{ pos: number; src: string }> {
  const found: Array<{ pos: number; src: string }> = [];
  view.state.doc.descendants((node, pos) => {
    const src = node.attrs.src;
    if (node.type.name === 'image' && typeof src === 'string' && !isLocal(src)) {
      found.push({ pos, src });
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
function swapImageSrc(view: EditorView, src: string, next: EditorUploadResult): void {
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

/**
 * Guard against a host returning a non-local src: it would be "external"
 * again and be re-ingested forever. Treat it as a failed import instead.
 */
function requireLocal(result: EditorUploadResult, isLocal: SrcCheck): EditorUploadResult {
  if (!isLocal(result.src)) {
    throw new Error(
      `track-changes: storage returned a non-local image src (${result.src}); ` +
        'add its origin to `localImageOrigins`',
    );
  }
  return result;
}

function createImageLocalizerExtension(
  ingest: EditorUrlIngestHandler | null,
  isLocal: SrcCheck,
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
              const found = externalImages(view, isLocal);
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
                    swapImageSrc(view, url, requireLocal(result, isLocal));
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
// Image import on paste / drop
//
// - pasted or dropped image **files** (screenshots, copied image files) go
//   through the editor's `uploadHandler`
// - a pasted **bare image / cloud-storage link** (Google Drive, OneDrive,
//   Dropbox, …) goes through `ingestUrl`; turning a share-page URL into the
//   actual file (and rejecting non-images) is the host backend's job. On
//   failure the URL is pasted as plain text — the paste the user would have
//   got anyway. A link that is already local is inserted directly.
//
// While a transfer runs, an "Importing image…" widget decoration marks the
// insertion point; decorations map through concurrent edits, so the images
// land where the user pasted even if they kept typing.
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

type ImportMeta = { add: { id: object; pos: number } } | { remove: { id: object } };

export const imageImportKey = new PluginKey<DecorationSet>('tcImageImport');

function imageFiles(list: FileList | null | undefined): File[] {
  return Array.from(list ?? []).filter((f) => f.type.startsWith('image/'));
}

interface ImageImportOptions {
  ingest: EditorUrlIngestHandler | null;
  linkMatcher: ((url: string) => boolean) | null;
  uploadFiles: boolean;
  isLocal: SrcCheck;
  pendingLabel: string;
  onEvent?: (event: ImagePasteEvent) => void;
}

function createImageImportExtension(opts: ImageImportOptions) {
  return Extension.create({
    name: 'imageImport',
    // Must see paste/drop before the track-changes clipboard plugin, which
    // claims every paste while suggesting.
    priority: 1000,
    addProseMirrorPlugins() {
      const editor = this.editor;

      const insertImages = (pos: number, images: EditorUploadResult[]) => {
        // Same position, reverse order → final document order matches input.
        for (const img of [...images].reverse()) {
          const node = editor.state.schema.nodes.image.create({ src: img.src, alt: img.alt ?? '' });
          featureInsertNode(editor, node, pos);
        }
      };

      /**
       * Show a placeholder at `pos`, run `task`, then call `done` with the
       * placeholder's mapped position (skipped if the editor is gone).
       */
      const withPlaceholder = <T>(
        view: EditorView,
        pos: number,
        task: Promise<T>,
        done: (pos: number, result: { ok: true; value: T } | { ok: false }) => void,
      ) => {
        const id = {};
        view.dispatch(view.state.tr.setMeta(imageImportKey, { add: { id, pos } }));
        const settle = (result: { ok: true; value: T } | { ok: false }) => {
          if (editor.isDestroyed) return;
          const found =
            imageImportKey.getState(view.state)?.find(undefined, undefined, (s) => s.id === id) ?? [];
          view.dispatch(view.state.tr.setMeta(imageImportKey, { remove: { id } }));
          if (found.length) done(found[0].from, result);
        };
        task.then(
          (value) => settle({ ok: true, value }),
          () => settle({ ok: false }),
        );
      };

      const uploadAt = (view: EditorView, pos: number, files: File[]): boolean => {
        const upload = getEditorUploadHandler(editor);
        if (!opts.uploadFiles || !upload || !files.length) return false;
        const task = Promise.allSettled(
          files.map((f) =>
            upload(f).then((r) => requireLocal({ src: r.src, alt: r.alt ?? f.name }, opts.isLocal)),
          ),
        );
        withPlaceholder(view, pos, task, (at, result) => {
          if (!result.ok) return;
          const images: EditorUploadResult[] = [];
          result.value.forEach((r, i) => {
            const url = files[i].name;
            if (r.status === 'fulfilled') {
              images.push(r.value);
              opts.onEvent?.({ status: 'uploaded', url, source: 'file' });
            } else {
              opts.onEvent?.({ status: 'rejected', url, source: 'file' });
            }
          });
          insertImages(at, images);
        });
        return true;
      };

      const linkAt = (view: EditorView, pos: number, url: string) => {
        if (opts.isLocal(url)) {
          insertImages(pos, [{ src: url }]);
          return;
        }
        const ingest = opts.ingest!;
        const task = ingest(url).then((r) => requireLocal(r, opts.isLocal));
        withPlaceholder(view, pos, task, (at, result) => {
          if (result.ok) {
            insertImages(at, [result.value]);
            opts.onEvent?.({ status: 'ingested', url, source: 'link' });
          } else {
            // Plain (untagged) insert: tracked while suggesting, like typing.
            view.dispatch(view.state.tr.insertText(url, at));
            opts.onEvent?.({ status: 'rejected', url, source: 'link' });
          }
        });
      };

      /** Clear the selection (tracked while suggesting) and return the insertion point. */
      const clearSelection = (view: EditorView): number => {
        // Untagged on purpose: while suggesting, replacing a selection
        // becomes a tracked deletion via the rewrite plugin.
        const tr = view.state.tr.deleteSelection();
        if (tr.docChanged) view.dispatch(tr);
        return view.state.selection.from;
      };

      return [
        new Plugin<DecorationSet>({
          key: imageImportKey,
          state: {
            init: () => DecorationSet.empty,
            apply(tr, set) {
              let next = set.map(tr.mapping, tr.doc);
              const meta = tr.getMeta(imageImportKey) as ImportMeta | undefined;
              if (meta && 'add' in meta) {
                const widget = Decoration.widget(
                  meta.add.pos,
                  (view) => {
                    const el = view.dom.ownerDocument.createElement('span');
                    el.className = 'tc-img-pending';
                    el.textContent = opts.pendingLabel;
                    return el;
                  },
                  { id: meta.add.id, side: -1 },
                );
                next = next.add(tr.doc, [widget]);
              } else if (meta && 'remove' in meta) {
                next = next.remove(next.find(undefined, undefined, (s) => s.id === meta.remove.id));
              }
              return next;
            },
          },
          props: {
            decorations: (state) => imageImportKey.getState(state),
            handlePaste(view, event) {
              const data = event.clipboardData;
              if (!data) return false;
              // Image markup (copied from a web page / cloud doc) goes through
              // the normal paste + the localizer, which copies its src.
              if (/<img[\s>]/i.test(data.getData('text/html'))) return false;

              const files = imageFiles(data.files);
              if (files.length) {
                if (!opts.uploadFiles || !getEditorUploadHandler(editor)) return false;
                return uploadAt(view, clearSelection(view), files);
              }

              const url = data.getData('text/plain').trim();
              if (!opts.linkMatcher || !BARE_URL.test(url) || !opts.linkMatcher(url)) return false;
              if (!opts.ingest && !opts.isLocal(url)) return false;
              linkAt(view, clearSelection(view), url);
              return true;
            },
            handleDrop(view, event, _slice, moved) {
              if (moved) return false;
              const files = imageFiles(event.dataTransfer?.files);
              if (!files.length) return false;
              const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
              return at ? uploadAt(view, at.pos, files) : false;
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
  /** Placeholder shown while a pasted/dropped image is being uploaded or imported. */
  importingImage: string;
}

export interface ImageUploadFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<ImageUploadFeatureLabels>;
  /** File-picker accept filter. */
  accept?: string;
  /**
   * Copies an external image URL into platform storage and resolves with
   * the local `src`. Used for pasted image markup and pasted image links.
   * Without a handler, external images are stripped on paste instead — they
   * are never kept as hotlinks either way.
   */
  ingestUrl?: EditorUrlIngestHandler | null;
  /**
   * Origins whose `http(s)` image URLs the platform owns — typically your
   * storage bucket and/or CDN, e.g. `['https://my-bucket.s3.amazonaws.com']`.
   * Images on these origins are never re-ingested or stripped, and pasted
   * links to them are inserted directly. Non-`http(s)` srcs (relative paths,
   * `data:` URLs) are always local.
   */
  localImageOrigins?: string[];
  /** Extra "is this src ours?" rule, for storage that can't be described by origin. */
  isLocalImageSrc?: (src: string) => boolean;
  /** Notified for every external image / image link / image file that is ingested, uploaded, rejected, or stripped. */
  onImagePaste?: (event: ImagePasteEvent) => void;
  /**
   * Pasting a bare image or cloud-storage link (e.g. `https://…/photo.png`,
   * a Google Drive / OneDrive / Dropbox share link) imports it through
   * `ingestUrl` and inserts the image; if ingestion fails, the URL is pasted
   * as plain text. Default `true` (using `isLikelyImageLink`) — pass your own
   * predicate to decide which links to try, or `false` to always paste links
   * as text.
   */
  pasteImageLinks?: boolean | ((url: string) => boolean);
  /**
   * Upload pasted or dropped image files (screenshots, copied image files)
   * through the editor's `uploadHandler`. Default `true`; no effect without
   * an `uploadHandler`.
   */
  uploadPastedFiles?: boolean;
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
  const isLocal = createLocalSrcCheck(options.localImageOrigins ?? [], options.isLocalImageSrc);
  const pasteImageLinks = options.pasteImageLinks ?? true;
  const linkMatcher =
    typeof pasteImageLinks === 'function' ? pasteImageLinks : pasteImageLinks ? isLikelyImageLink : null;

  return {
    name: 'imageUpload',
    extensions: () => [
      TrackedImage,
      createImageLocalizerExtension(ingestUrl, isLocal, options.onImagePaste),
      createImageImportExtension({
        ingest: ingestUrl,
        linkMatcher,
        uploadFiles: options.uploadPastedFiles ?? true,
        isLocal,
        pendingLabel: labels.importingImage,
        onEvent: options.onImagePaste,
      }),
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
          const result = requireLocal(await upload(file), isLocal);
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
