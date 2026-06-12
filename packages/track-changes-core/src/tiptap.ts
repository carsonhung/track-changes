import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { createSuggestingPlugin, type SuggestingOptions } from './plugin';
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
 * `@tdg-reports/track-changes-styles`.
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
    return [{ tag: 'ins[data-suggestion]' }];
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
    return [{ tag: 'del[data-suggestion]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['del', mergeAttributes({ class: 'tc-del' }, HTMLAttributes), 0];
  },
});

export interface TrackChangesExtensionOptions {
  suggesting: boolean;
  authorId: string | null;
}

/**
 * Bundles the two suggestion marks and the suggesting plugin into one Tiptap
 * extension. Mode/author are applied imperatively via the `setSuggesting` /
 * `setSuggestionAuthor` commands (see `commands.ts`) rather than Tiptap custom
 * commands, to avoid module augmentation and keep the core framework-neutral.
 */
export const TrackChanges = Extension.create<TrackChangesExtensionOptions>({
  name: 'trackChanges',
  addOptions() {
    return { suggesting: false, authorId: null };
  },
  addExtensions() {
    return [InsertionMark, DeletionMark];
  },
  addProseMirrorPlugins() {
    return [createSuggestingPlugin({ suggesting: this.options.suggesting, authorId: this.options.authorId })];
  },
});

export function createTrackChangesExtension(options?: Partial<TrackChangesExtensionOptions>) {
  return TrackChanges.configure(options ?? {});
}

export type { SuggestingOptions };
