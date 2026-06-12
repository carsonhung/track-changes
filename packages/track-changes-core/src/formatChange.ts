import type { Mark, MarkSpec, MarkType, Schema } from '@tiptap/pm/model';

/**
 * Format-change suggestions (P2f).
 *
 * Inserting/deleting content is tracked by the `insertion`/`deletion` marks.
 * Toggling formatting on EXISTING text (bold, italic, strike, …) changes no
 * content, so it gets its own encoding: the formatting is applied (or removed)
 * for real, and a `format_change` mark is layered over the affected range
 * recording what happened — still document data, never plugin state:
 *
 * - `action: 'add'`    — `markName` was applied here.   Accept → keep it (drop
 *   the format_change mark). Reject → remove `markName` again.
 * - `action: 'remove'` — `markName` was removed here.   Accept → keep it
 *   removed. Reject → re-apply `markName`.
 *
 * `excludes: ''` lets several format_change marks stack on the same text
 * (e.g. bold added AND italic removed in one review cycle).
 *
 * Serializes to `<span data-suggestion data-suggestion-format="add:bold">` so
 * HTML persistence stays lossless. Scope (v1): attribute-less marks only —
 * bold / italic / strike and friends. Block-type changes (heading, lists) pass
 * through untracked by design of the mark model.
 */

/** Mark name. Stable string: persisted into documents, do not rename. */
export const FORMAT_CHANGE = 'format_change';

export type FormatAction = 'add' | 'remove';

export interface FormatChangeAttrs {
  id: string;
  authorId: string | null;
  ts: number | null;
  action: FormatAction;
  /** Name of the formatting mark that was toggled (e.g. `bold`). */
  markName: string;
}

function parseFormatAttr(value: string | null): { action: FormatAction; markName: string } | null {
  if (!value) return null;
  const idx = value.indexOf(':');
  if (idx <= 0) return null;
  const action = value.slice(0, idx);
  const markName = value.slice(idx + 1);
  if ((action !== 'add' && action !== 'remove') || !markName) return null;
  return { action, markName };
}

function getAttrsFromDom(el: HTMLElement): FormatChangeAttrs | false {
  const parsed = parseFormatAttr(el.getAttribute('data-suggestion-format'));
  const id = el.getAttribute('data-suggestion');
  if (!parsed || !id) return false;
  const ts = Number(el.getAttribute('data-ts'));
  return {
    id,
    authorId: el.getAttribute('data-author') || null,
    ts: Number.isFinite(ts) && ts > 0 ? ts : null,
    action: parsed.action,
    markName: parsed.markName,
  };
}

function toDomAttrs(attrs: FormatChangeAttrs): Record<string, string> {
  return {
    'data-suggestion': attrs.id,
    'data-suggestion-format': `${attrs.action}:${attrs.markName}`,
    'data-author': attrs.authorId ?? '',
    'data-ts': String(attrs.ts ?? ''),
    class: attrs.action === 'add' ? 'tc-fmt tc-fmt-add' : 'tc-fmt tc-fmt-del',
  };
}

/** Raw ProseMirror MarkSpec for a tracked formatting change. */
export const formatChangeMarkSpec: MarkSpec = {
  attrs: {
    id: {},
    authorId: { default: null },
    ts: { default: null },
    action: {},
    markName: {},
  },
  inclusive: false,
  // Exclude nothing — several format_change marks (different toggles) may
  // stack on the same text.
  excludes: '',
  parseDOM: [
    {
      tag: 'span[data-suggestion-format]',
      getAttrs: (dom) => getAttrsFromDom(dom as HTMLElement),
    },
  ],
  toDOM: (mark) => ['span', toDomAttrs(mark.attrs as FormatChangeAttrs), 0],
};

export function formatChangeType(schema: Schema): MarkType {
  const type = schema.marks[FORMAT_CHANGE];
  if (!type) throw new Error('track-changes: "format_change" mark is not registered in the schema');
  return type;
}

/** Read & validate a format_change mark's attrs, or null for other marks. */
export function readFormatChange(mark: Mark): FormatChangeAttrs | null {
  if (mark.type.name !== FORMAT_CHANGE) return null;
  const a = mark.attrs as Partial<FormatChangeAttrs>;
  if (!a.id || (a.action !== 'add' && a.action !== 'remove') || !a.markName) return null;
  return {
    id: String(a.id),
    authorId: a.authorId ?? null,
    ts: typeof a.ts === 'number' && Number.isFinite(a.ts) ? a.ts : null,
    action: a.action,
    markName: String(a.markName),
  };
}
