import type { AnyExtension } from '@tiptap/core';
import type { Editor } from '@tiptap/vue-3';

/**
 * CKEditor-style editor features. A feature is a self-contained bundle of:
 *
 * - **engine** — the Tiptap extensions (nodes/marks/plugins) it needs
 * - **UI** — toolbar items rendered by `<TrackChangesEditor>`'s built-in toolbar
 * - **platform glue** — host hooks it consumes from the feature context
 *   (currently `upload`, e.g. wired to an attachments API)
 *
 * Hosts compose an editor by passing `features: [...]`, exactly like CKEditor's
 * `plugins: [...]` config. Features are framework-light (plain objects + `h`-free
 * render contract): the toolbar markup itself is owned by the editor component,
 * so features stay testable and styling stays in one place.
 *
 * Track-changes awareness is the feature author's job: insert/delete through
 * the core's `suggestInsertNode` / `suggestDeleteNode` when suggesting (see
 * `featureCommands.ts` helpers) so feature edits are suggestions like any other.
 */

/** What a host upload handler resolves with — enough to render the node. */
export interface EditorUploadResult {
  src: string;
  alt?: string;
}

/**
 * Host-provided upload glue. The package never talks to a backend itself;
 * the app decides where bytes go (attachments API, data URLs, object storage).
 */
export type EditorUploadHandler = (file: File) => Promise<EditorUploadResult>;

/** Live context passed to every toolbar item callback. */
export interface EditorFeatureContext {
  editor: Editor;
  upload: EditorUploadHandler | null;
}

export interface EditorToolbarItem {
  id: string;
  /** Accessible name (aria-label + tooltip). */
  label: string;
  /** Short visible text for the default toolbar button (host CSS may iconify). */
  text: string;
  isEnabled?: (ctx: EditorFeatureContext) => boolean;
  isActive?: (ctx: EditorFeatureContext) => boolean;
  run: (ctx: EditorFeatureContext) => void | Promise<void>;
}

export interface EditorFeature {
  name: string;
  /** Tiptap extensions this feature contributes to the editor schema. */
  extensions?: () => AnyExtension[];
  /** Toolbar contributions, evaluated against the live editor on every transaction. */
  toolbarItems?: () => EditorToolbarItem[];
}
