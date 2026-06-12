import type { MarkSpec, MarkType, Schema } from '@tiptap/pm/model';

/** Mark names. Stable strings: persisted into the document, do not rename. */
export const INSERTION = 'insertion';
export const DELETION = 'deletion';

/**
 * The two kinds of suggestion. Shared by both encodings — inline marks
 * (`marks.ts`) and the block/structural node attribute (`nodeAttrs.ts`) — so the
 * accept/reject engine treats them uniformly. Lives here to avoid an
 * `nodeAttrs` ↔ `clean` import cycle.
 */
export type SuggestionType = 'insertion' | 'deletion';

/**
 * Suggestion mark attributes. `id` groups a logical change; `authorId` and `ts`
 * support per-author rendering and audit. Encoded as document data (a mark),
 * never plugin state, so it survives serialization and (future) Yjs sync.
 */
export interface SuggestionAttrs {
  id: string;
  authorId: string | null;
  ts: number | null;
}

function getAttrs(el: HTMLElement): SuggestionAttrs {
  const ts = Number(el.getAttribute('data-ts'));
  return {
    id: el.getAttribute('data-suggestion') ?? '',
    authorId: el.getAttribute('data-author') ?? null,
    ts: Number.isFinite(ts) && ts > 0 ? ts : null,
  };
}

/** Raw ProseMirror MarkSpec for inserted (suggested-added) text. */
export const insertionMarkSpec: MarkSpec = {
  attrs: { id: {}, authorId: { default: null }, ts: { default: null } },
  inclusive: true,
  parseDOM: [{ tag: 'ins[data-suggestion]', getAttrs: (dom) => getAttrs(dom as HTMLElement) }],
  toDOM: (mark) => [
    'ins',
    {
      'data-suggestion': mark.attrs.id,
      'data-author': mark.attrs.authorId ?? '',
      'data-ts': String(mark.attrs.ts ?? ''),
      class: 'tc-ins',
    },
    0,
  ],
};

/** Raw ProseMirror MarkSpec for deleted (suggested-removed) text. */
export const deletionMarkSpec: MarkSpec = {
  attrs: { id: {}, authorId: { default: null }, ts: { default: null } },
  inclusive: false,
  parseDOM: [{ tag: 'del[data-suggestion]', getAttrs: (dom) => getAttrs(dom as HTMLElement) }],
  toDOM: (mark) => [
    'del',
    {
      'data-suggestion': mark.attrs.id,
      'data-author': mark.attrs.authorId ?? '',
      'data-ts': String(mark.attrs.ts ?? ''),
      class: 'tc-del',
    },
    0,
  ],
};

export function insertionType(schema: Schema): MarkType {
  const type = schema.marks[INSERTION];
  if (!type) throw new Error('track-changes: "insertion" mark is not registered in the schema');
  return type;
}

export function deletionType(schema: Schema): MarkType {
  const type = schema.marks[DELETION];
  if (!type) throw new Error('track-changes: "deletion" mark is not registered in the schema');
  return type;
}
