import { Schema, type SchemaSpec } from '@tiptap/pm/model';
import { INSERTION, DELETION, insertionMarkSpec, deletionMarkSpec } from './marks';

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
