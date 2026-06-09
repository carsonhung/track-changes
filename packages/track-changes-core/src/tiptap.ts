import { Extension, Mark, mergeAttributes } from '@tiptap/core';
import { createSuggestingPlugin, type SuggestingOptions } from './plugin';

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
