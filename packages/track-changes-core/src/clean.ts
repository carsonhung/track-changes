import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { INSERTION, DELETION, insertionType, deletionType } from './marks';

export type SuggestionType = 'insertion' | 'deletion';

export interface SuggestionRange {
  from: number;
  to: number;
  mark: Mark;
}

export interface SuggestionSummary {
  id: string;
  type: SuggestionType;
  authorId: string | null;
  ts: number | null;
  /** Concatenated text the suggestion covers (added text, or to-be-removed text). */
  text: string;
  from: number;
  to: number;
}

/** Collect contiguous text ranges carrying a given mark name. */
function rangesByMark(doc: PMNode, name: string): SuggestionRange[] {
  const out: SuggestionRange[] = [];
  doc.descendants((node, pos) => {
    if (!node.isText) return;
    const mark = node.marks.find((m) => m.type.name === name);
    if (mark) out.push({ from: pos, to: pos + node.nodeSize, mark });
  });
  return out;
}

function deleteRangesDesc(tr: Transform, ranges: SuggestionRange[]): void {
  [...ranges].sort((a, b) => b.from - a.from).forEach((r) => tr.delete(r.from, r.to));
}

function removeMarkDesc(tr: Transform, ranges: SuggestionRange[], name: string): void {
  const type = name === INSERTION ? insertionType(tr.doc.type.schema) : deletionType(tr.doc.type.schema);
  [...ranges].sort((a, b) => b.from - a.from).forEach((r) => tr.removeMark(r.from, r.to, type));
}

// ---------------------------------------------------------------------------
// Transform mutators — reused as editor commands (pass `state.tr`) and as pure
// `doc -> doc` projections (pass `new Transform(doc)`).
// ---------------------------------------------------------------------------

/** Accept every suggestion: keep inserted text, drop deleted text. */
export function acceptAllOn(tr: Transform): void {
  deleteRangesDesc(tr, rangesByMark(tr.doc, DELETION));
  // Re-scan after deletions so insertion positions are current.
  removeMarkDesc(tr, rangesByMark(tr.doc, INSERTION), INSERTION);
}

/** Reject every suggestion: drop inserted text, keep deleted text. */
export function rejectAllOn(tr: Transform): void {
  deleteRangesDesc(tr, rangesByMark(tr.doc, INSERTION));
  removeMarkDesc(tr, rangesByMark(tr.doc, DELETION), DELETION);
}

/** Accept a single suggestion by id. */
export function acceptOn(tr: Transform, id: string): void {
  deleteRangesDesc(tr, rangesByMark(tr.doc, DELETION).filter((r) => r.mark.attrs.id === id));
  removeMarkDesc(tr, rangesByMark(tr.doc, INSERTION).filter((r) => r.mark.attrs.id === id), INSERTION);
}

/** Reject a single suggestion by id. */
export function rejectOn(tr: Transform, id: string): void {
  deleteRangesDesc(tr, rangesByMark(tr.doc, INSERTION).filter((r) => r.mark.attrs.id === id));
  removeMarkDesc(tr, rangesByMark(tr.doc, DELETION).filter((r) => r.mark.attrs.id === id), DELETION);
}

// ---------------------------------------------------------------------------
// Pure projections
// ---------------------------------------------------------------------------

/** The accepted (final) document: insertions kept, deletions removed. */
export function toClean(doc: PMNode): PMNode {
  const tr = new Transform(doc);
  acceptAllOn(tr);
  return tr.doc;
}

/** The rejected document: insertions removed, deletions restored. */
export function toRejected(doc: PMNode): PMNode {
  const tr = new Transform(doc);
  rejectAllOn(tr);
  return tr.doc;
}

/** The marked-up (audit) document. Identity today; named for intent + symmetry. */
export function toTracked(doc: PMNode): PMNode {
  return doc;
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Summarise every suggestion in the document, ordered by position. */
export function listSuggestions(doc: PMNode): SuggestionSummary[] {
  const byId = new Map<string, SuggestionSummary>();
  const scan = (name: SuggestionType) => {
    doc.descendants((node, pos) => {
      if (!node.isText) return;
      const mark = node.marks.find((m) => m.type.name === name);
      if (!mark) return;
      const id = String(mark.attrs.id);
      const text = node.text ?? '';
      const existing = byId.get(id);
      if (existing) {
        existing.to = pos + node.nodeSize;
        existing.text += text;
      } else {
        byId.set(id, {
          id,
          type: name,
          authorId: (mark.attrs.authorId as string | null) ?? null,
          ts: (mark.attrs.ts as number | null) ?? null,
          text,
          from: pos,
          to: pos + node.nodeSize,
        });
      }
    });
  };
  scan(INSERTION);
  scan(DELETION);
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

/** Whether the document currently carries any tracked suggestion. */
export function hasSuggestions(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.isText && node.marks.some((m) => m.type.name === INSERTION || m.type.name === DELETION)) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}
