import { Extension, Mark, mergeAttributes, type Node } from '@tiptap/core';
import {
  createTextSuggestingPlugin,
  createClipboardSuggestingPlugin,
  type SuggestingOptions,
} from './plugin';
import { createRewriteSuggestingPlugin } from './rewrite';
import { createTrackChangesStatePlugin } from './state';
import { FORMAT_CHANGE, type FormatChangeAttrs } from './formatChange';
import { SUGGESTION_PARSE_PRIORITY } from './marks';
import {
  SUGGESTION_NODE_ATTR,
  suggestionFromDom,
  suggestionToDomAttrs,
  type NodeSuggestion,
} from './nodeAttrs';

/**
 * Tiptap `addAttributes()` fragment that makes a node trackable via the
 * `suggestion` node attribute. Spread it into a node extension's own
 * `addAttributes()` so block / structural nodes (block image, table row) carry
 * and render the suggestion state:
 *
 * ```ts
 * Image.extend({
 *   addAttributes() {
 *     return { ...this.parent?.(), ...suggestionNodeAttributes() }
 *   },
 * })
 * ```
 *
 * The attribute renders to `data-suggestion` / `data-suggestion-type` /
 * `data-author` / `data-ts` plus a `tc-node-ins` / `tc-node-del` class, matching
 * `track-changes-styles`.
 */
export function suggestionNodeAttributes() {
  return {
    [SUGGESTION_NODE_ATTR]: {
      default: null as NodeSuggestion | null,
      parseHTML: (el: HTMLElement) => suggestionFromDom(el),
      renderHTML: (attrs: Record<string, unknown>) =>
        suggestionToDomAttrs((attrs[SUGGESTION_NODE_ATTR] as NodeSuggestion | null) ?? null),
    },
  };
}

/**
 * Tiptap (MIT) marks mirroring the raw ProseMirror MarkSpecs in `marks.ts`, so
 * the editor schema round-trips `<ins data-suggestion>` / `<del data-suggestion>`
 * HTML for screen, print, and PDF export.
 */
export const InsertionMark = Mark.create({
  name: 'insertion',
  inclusive: () => true,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggestion'),
        renderHTML: (attrs) => (attrs.id ? { 'data-suggestion': attrs.id } : {}),
      },
      authorId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-author') || null,
        renderHTML: (attrs) => (attrs.authorId ? { 'data-author': attrs.authorId } : {}),
      },
      ts: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-ts')) || null,
        renderHTML: (attrs) => (attrs.ts ? { 'data-ts': String(attrs.ts) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'ins[data-suggestion]', priority: SUGGESTION_PARSE_PRIORITY }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['ins', mergeAttributes({ class: 'tc-ins' }, HTMLAttributes), 0];
  },
});

export const DeletionMark = Mark.create({
  name: 'deletion',
  inclusive: () => false,
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggestion'),
        renderHTML: (attrs) => (attrs.id ? { 'data-suggestion': attrs.id } : {}),
      },
      authorId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-author') || null,
        renderHTML: (attrs) => (attrs.authorId ? { 'data-author': attrs.authorId } : {}),
      },
      ts: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-ts')) || null,
        renderHTML: (attrs) => (attrs.ts ? { 'data-ts': String(attrs.ts) } : {}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'del[data-suggestion]', priority: SUGGESTION_PARSE_PRIORITY }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['del', mergeAttributes({ class: 'tc-del' }, HTMLAttributes), 0];
  },
});

/**
 * Tiptap mark mirroring `formatChangeMarkSpec` (see `formatChange.ts`): a
 * tracked formatting toggle on existing text. `excludes: ''` lets several
 * toggles (bold added, italic removed) stack on the same range.
 */
export const FormatChangeMark = Mark.create({
  name: FORMAT_CHANGE,
  inclusive: () => false,
  excludes: '',
  addAttributes() {
    return {
      id: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-suggestion'),
        renderHTML: (attrs) => (attrs.id ? { 'data-suggestion': attrs.id } : {}),
      },
      authorId: {
        default: null,
        parseHTML: (el) => el.getAttribute('data-author') || null,
        renderHTML: (attrs) => (attrs.authorId ? { 'data-author': attrs.authorId } : {}),
      },
      ts: {
        default: null,
        parseHTML: (el) => Number(el.getAttribute('data-ts')) || null,
        renderHTML: (attrs) => (attrs.ts ? { 'data-ts': String(attrs.ts) } : {}),
      },
      action: {
        default: 'add',
        parseHTML: (el) => el.getAttribute('data-suggestion-format')?.split(':')[0] ?? null,
        renderHTML: () => ({}),
      },
      markName: {
        default: null,
        parseHTML: (el) => {
          const v = el.getAttribute('data-suggestion-format');
          const idx = v?.indexOf(':') ?? -1;
          return idx > 0 ? v!.slice(idx + 1) : null;
        },
        renderHTML: () => ({}),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-suggestion-format]', priority: SUGGESTION_PARSE_PRIORITY }];
  },
  renderHTML({ mark, HTMLAttributes }) {
    const a = mark.attrs as FormatChangeAttrs;
    return [
      'span',
      mergeAttributes(
        {
          'data-suggestion-format': `${a.action}:${a.markName}`,
          class: a.action === 'add' ? 'tc-fmt tc-fmt-add' : 'tc-fmt tc-fmt-del',
        },
        HTMLAttributes,
      ),
      0,
    ];
  },
});

export interface TrackChangesExtensionOptions {
  suggesting: boolean;
  authorId: string | null;
}

// ---------------------------------------------------------------------------
// Modular Tiptap extensions (CKEditor-style composition): one core editing
// extension owning schema + state, plus per-surface feature extensions. The
// `TrackChanges` glue bundles them all; hosts wanting fine-grained control
// (e.g. text tracking without clipboard interception) compose manually.
// ---------------------------------------------------------------------------

/**
 * Core editing extension — registers the suggestion marks and the state plugin
 * (mode/author). Required by every feature extension; carries the options.
 */
export const TrackChangesCore = Extension.create<TrackChangesExtensionOptions>({
  name: 'trackChangesCore',
  addOptions() {
    return { suggesting: false, authorId: null };
  },
  addExtensions() {
    return [InsertionMark, DeletionMark, FormatChangeMark];
  },
  addProseMirrorPlugins() {
    return [
      createTrackChangesStatePlugin({
        suggesting: this.options.suggesting,
        authorId: this.options.authorId,
      }),
    ];
  },
});

/** Feature extension: typed text + Backspace/Delete become suggestions. */
export const TrackChangesText = Extension.create({
  name: 'trackChangesText',
  addProseMirrorPlugins() {
    return [createTextSuggestingPlugin()];
  },
});

/** Feature extension: paste becomes a tracked insertion; cut a tracked deletion. */
export const TrackChangesClipboard = Extension.create({
  name: 'trackChangesClipboard',
  addProseMirrorPlugins() {
    return [createClipboardSuggestingPlugin()];
  },
});

/**
 * Feature extension: safety net for input the prop-based features can't see
 * (IME composition, drag-and-drop moves, programmatic edits) — untagged
 * doc-changing transactions are rewritten into suggestion form.
 */
export const TrackChangesRewrite = Extension.create({
  name: 'trackChangesRewrite',
  addProseMirrorPlugins() {
    return [createRewriteSuggestingPlugin()];
  },
});

/**
 * Glue extension bundling the full set (core + text + clipboard + rewrite). Mode/author
 * are applied imperatively via the `setSuggesting` / `setSuggestionAuthor`
 * commands (see `commands.ts`) rather than Tiptap custom commands, to avoid
 * module augmentation and keep the core framework-neutral.
 */
export const TrackChanges = Extension.create<TrackChangesExtensionOptions>({
  name: 'trackChanges',
  addOptions() {
    return { suggesting: false, authorId: null };
  },
  addExtensions() {
    return [
      TrackChangesCore.configure({
        suggesting: this.options.suggesting,
        authorId: this.options.authorId,
      }),
      TrackChangesText,
      TrackChangesClipboard,
      TrackChangesRewrite,
    ];
  },
});

export function createTrackChangesExtension(options?: Partial<TrackChangesExtensionOptions>) {
  return TrackChanges.configure(options ?? {});
}

/**
 * Per-component integration helper: wrap any Tiptap Node extension so its nodes
 * carry (and render) the `suggestion` attribute — the one-line equivalent of a
 * CKEditor feature integration plugin:
 *
 * ```ts
 * const TrackedTableRow = trackableNode(TableRow)
 * const TrackedImage    = trackableNode(Image)
 * ```
 */
export function trackableNode<N extends Node>(node: N): N {
  // `extend` widens the generic signature; the runtime shape is unchanged.
  return node.extend({
    addAttributes() {
      return { ...(this.parent?.() ?? {}), ...suggestionNodeAttributes() };
    },
  }) as N;
}

export type { SuggestingOptions };
