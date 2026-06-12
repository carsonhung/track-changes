import { Schema, type SchemaSpec } from '@tiptap/pm/model';
import { INSERTION, DELETION, insertionMarkSpec, deletionMarkSpec } from './marks';
import { suggestionNodeAttrSpec } from './nodeAttrs';

/**
 * Return a new SchemaSpec with the suggestion marks added to a base spec. Use
 * this to add track-changes to a raw ProseMirror schema (the Tiptap path uses
 * `createTrackChangesExtension()` instead).
 */
export function withSuggestionMarks(spec: SchemaSpec): SchemaSpec {
  const marks = { ...(spec.marks as Record<string, unknown>) };
  marks[INSERTION] = insertionMarkSpec;
  marks[DELETION] = deletionMarkSpec;
  return { ...spec, marks } as SchemaSpec;
}

/**
 * Minimal standalone schema (doc / paragraph / text + suggestion marks). Handy
 * for headless tests and consumers that do not use Tiptap.
 */
export function createBasicSuggestionSchema(): Schema {
  return new Schema(
    withSuggestionMarks({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          group: 'block',
          content: 'inline*',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
        text: { group: 'inline' },
      },
      marks: {},
    }),
  );
}

/**
 * Extended schema adding the node types exercised by node-level track changes:
 * an inline `image` atom (carries suggestion *marks*), a block `figure` atom and
 * a minimal `table` / `tableRow` / `tableCell` (carry the `suggestion` node
 * *attribute*). For headless tests and consumers without Tiptap.
 */
export function createExtendedSuggestionSchema(): Schema {
  return new Schema(
    withSuggestionMarks({
      nodes: {
        doc: { content: 'block+' },
        paragraph: {
          group: 'block',
          content: 'inline*',
          parseDOM: [{ tag: 'p' }],
          toDOM: () => ['p', 0],
        },
        text: { group: 'inline' },
        image: {
          group: 'inline',
          inline: true,
          atom: true,
          marks: '_',
          attrs: { src: { default: '' }, alt: { default: '' } },
          parseDOM: [{ tag: 'img[src]' }],
          toDOM: (node) => ['img', { src: node.attrs.src, alt: node.attrs.alt }],
        },
        figure: {
          group: 'block',
          atom: true,
          attrs: { src: { default: '' }, ...suggestionNodeAttrSpec() },
          parseDOM: [{ tag: 'figure' }],
          toDOM: (node) => ['figure', ['img', { src: node.attrs.src }]],
        },
        table: {
          group: 'block',
          content: 'tableRow+',
          parseDOM: [{ tag: 'table' }],
          toDOM: () => ['table', ['tbody', 0]],
        },
        tableRow: {
          content: 'tableCell+',
          attrs: { ...suggestionNodeAttrSpec() },
          parseDOM: [{ tag: 'tr' }],
          toDOM: () => ['tr', 0],
        },
        tableCell: {
          content: 'inline*',
          attrs: { ...suggestionNodeAttrSpec() },
          parseDOM: [{ tag: 'td' }],
          toDOM: () => ['td', 0],
        },
      },
      marks: {},
    }),
  );
}
