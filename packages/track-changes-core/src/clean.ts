import type { Mark, Node as PMNode } from '@tiptap/pm/model';
import { Transform } from '@tiptap/pm/transform';
import { INSERTION, DELETION, insertionType, deletionType, type SuggestionType } from './marks';
import { SUGGESTION_NODE_ATTR, readNodeSuggestion } from './nodeAttrs';
import { FORMAT_CHANGE, readFormatChange, type FormatAction } from './formatChange';

export type { SuggestionType };

/** Summary `type`: content suggestions plus tracked formatting changes (P2f). */
export type SuggestionSummaryType = SuggestionType | 'format';

export interface SuggestionRange {
  from: number;
  to: number;
  mark: Mark;
}

export interface SuggestionSummary {
  id: string;
  type: SuggestionSummaryType;
  /** How the suggestion is encoded: an inline `mark` (text/atom) or a `node` attribute. */
  kind: 'mark' | 'node';
  authorId: string | null;
  ts: number | null;
  /** Concatenated text the suggestion covers; empty for non-text nodes. */
  text: string;
  /** Node type name for `node`/atom suggestions (e.g. `image`, `tableRow`); undefined for text. */
  nodeType?: string;
  /** For `type: 'format'` — whether the formatting was applied or removed. */
  formatAction?: FormatAction;
  /** For `type: 'format'` — the toggled formatting mark (e.g. `bold`). */
  formatMark?: string;
  from: number;
  to: number;
}

// ---------------------------------------------------------------------------
// Unified suggestion unit — the engine treats inline marks (on text or inline
// atoms) and block/structural node attributes the same way.
// ---------------------------------------------------------------------------

interface MarkUnit {
  kind: 'mark';
  type: SuggestionType;
  id: string;
  authorId: string | null;
  ts: number | null;
  from: number;
  to: number;
  text: string;
  nodeType?: string;
}

interface NodeUnit {
  kind: 'node';
  type: SuggestionType;
  id: string;
  authorId: string | null;
  ts: number | null;
  pos: number;
  nodeSize: number;
  attrs: Record<string, unknown>;
  nodeType: string;
}

/** A tracked formatting change segment (the `format_change` mark, P2f). */
interface FormatUnit {
  kind: 'format';
  id: string;
  authorId: string | null;
  ts: number | null;
  action: FormatAction;
  markName: string;
  /** Exact mark instance, so stripping one stacked toggle leaves the others. */
  mark: Mark;
  from: number;
  to: number;
  text: string;
}

type Unit = MarkUnit | NodeUnit;

const unitFrom = (u: Unit): number => (u.kind === 'mark' ? u.from : u.pos);
const unitTo = (u: Unit): number => (u.kind === 'mark' ? u.to : u.pos + u.nodeSize);

/** Collect every suggestion unit in document order (marks first, then the node it sits on). */
function collectUnits(doc: PMNode): Unit[] {
  const out: Unit[] = [];
  doc.descendants((node, pos) => {
    const ins = node.marks.find((m) => m.type.name === INSERTION);
    const del = node.marks.find((m) => m.type.name === DELETION);
    const pushMark = (type: SuggestionType, mark: Mark) => {
      out.push({
        kind: 'mark',
        type,
        id: String(mark.attrs.id),
        authorId: (mark.attrs.authorId as string | null) ?? null,
        ts: (mark.attrs.ts as number | null) ?? null,
        from: pos,
        to: pos + node.nodeSize,
        text: node.text ?? '',
        nodeType: node.isText ? undefined : node.type.name,
      });
    };
    if (ins) pushMark('insertion', ins);
    if (del) pushMark('deletion', del);

    const s = readNodeSuggestion(node);
    if (s) {
      out.push({
        kind: 'node',
        type: s.type,
        id: s.id,
        authorId: s.authorId,
        ts: s.ts,
        pos,
        nodeSize: node.nodeSize,
        attrs: node.attrs as Record<string, unknown>,
        nodeType: node.type.name,
      });
    }
    return undefined;
  });
  return out;
}

/** Collect every tracked-formatting segment in document order. */
function collectFormatUnits(doc: PMNode): FormatUnit[] {
  const out: FormatUnit[] = [];
  doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      const f = readFormatChange(mark);
      if (!f) continue;
      out.push({
        kind: 'format',
        id: f.id,
        authorId: f.authorId,
        ts: f.ts,
        action: f.action,
        markName: f.markName,
        mark,
        from: pos,
        to: pos + node.nodeSize,
        text: node.text ?? '',
      });
    }
    return undefined;
  });
  return out;
}

/**
 * Resolve tracked formatting changes. Accept keeps the formatting as toggled;
 * reject inverts the toggle (add → remove the mark again, remove → re-apply).
 * Both end by stripping the `format_change` mark. All ops are size-stable, so
 * one fresh scan is valid for the whole pass.
 */
function resolveFormatUnits(tr: Transform, accept: boolean, id?: string): void {
  const schema = tr.doc.type.schema;
  collectFormatUnits(tr.doc)
    .filter((u) => id === undefined || u.id === id)
    .forEach((u) => {
      if (!accept) {
        const target = schema.marks[u.markName];
        if (target) {
          if (u.action === 'add') tr.removeMark(u.from, u.to, target);
          else tr.addMark(u.from, u.to, target.create());
        }
      }
      tr.removeMark(u.from, u.to, u.mark);
    });
}

/**
 * Delete the given units. Positions are remapped through the transaction as we
 * go, so deleting an ancestor node first collapses its descendants' ranges to
 * empty (skipped) — nested suggestions resolve correctly.
 */
function deleteUnits(tr: Transform, units: Unit[]): void {
  units
    .slice()
    .sort((a, b) => unitFrom(a) - unitFrom(b))
    .forEach((u) => {
      const from = tr.mapping.map(unitFrom(u));
      const to = tr.mapping.map(unitTo(u));
      if (to > from) tr.delete(from, to);
    });
}

/**
 * Strip the suggestion encoding from units that should be kept (re-scanned from
 * the current doc so positions are fresh). Mark removal and `setNodeMarkup` are
 * size-stable, so a single fresh scan stays valid across the whole pass.
 */
function stripUnits(tr: Transform, want: (u: Unit) => boolean): void {
  const schema = tr.doc.type.schema;
  collectUnits(tr.doc)
    .filter(want)
    .forEach((u) => {
      if (u.kind === 'mark') {
        const type = u.type === INSERTION ? insertionType(schema) : deletionType(schema);
        tr.removeMark(u.from, u.to, type);
      } else {
        tr.setNodeMarkup(u.pos, undefined, { ...u.attrs, [SUGGESTION_NODE_ATTR]: null });
      }
    });
}

// ---------------------------------------------------------------------------
// Transform mutators — reused as editor commands (pass `state.tr`) and as pure
// `doc -> doc` projections (pass `new Transform(doc)`).
// ---------------------------------------------------------------------------

function resolve(tr: Transform, accept: boolean, id?: string): void {
  const remove: SuggestionType = accept ? 'deletion' : 'insertion';
  const keep: SuggestionType = accept ? 'insertion' : 'deletion';
  const match = (u: Unit) => (id === undefined || u.id === id);
  deleteUnits(tr, collectUnits(tr.doc).filter((u) => u.type === remove && match(u)));
  stripUnits(tr, (u) => u.type === keep && match(u));
  // Formatting suggestions last: content deletes have settled, and format
  // resolution is size-stable so its own fresh scan stays valid throughout.
  resolveFormatUnits(tr, accept, id);
}

/** Accept every suggestion: keep inserted content, drop deleted content. */
export function acceptAllOn(tr: Transform): void {
  resolve(tr, true);
}

/** Reject every suggestion: drop inserted content, keep deleted content. */
export function rejectAllOn(tr: Transform): void {
  resolve(tr, false);
}

/** Accept a single suggestion by id. */
export function acceptOn(tr: Transform, id: string): void {
  resolve(tr, true, id);
}

/** Reject a single suggestion by id. */
export function rejectOn(tr: Transform, id: string): void {
  resolve(tr, false, id);
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

/**
 * CJK characters that count as one word each (the MS Word "字数" convention,
 * since these scripts don't separate words with spaces): Han ideographs
 * (unified + extension A + compatibility) and Japanese kana. Hangul is
 * excluded — Korean uses spaces between words, so whitespace splitting is
 * already correct for it.
 */
const CJK_CHAR = /[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3040-\u30FF]/gu;

/**
 * CJK punctuation and full-width forms (，。「」！？ etc.) — word separators,
 * never words themselves.
 */
const CJK_PUNCT = /[\u3000-\u303F\uFF00-\uFFEF]/gu;

/**
 * Word count of a plain-text string: every CJK character is one word, and the
 * remaining (non-CJK) text counts whitespace-separated runs; CJK punctuation
 * separates without counting. Mixed text works naturally —
 * "本项目使用 machine learning 方法" = 7 CJK + 2 Latin = 9.
 */
export function countWords(text: string): number {
  const cjk = text.match(CJK_CHAR)?.length ?? 0;
  const rest = text.replace(CJK_CHAR, ' ').replace(CJK_PUNCT, ' ');
  const latin = rest.split(/\s+/).filter(Boolean).length;
  return cjk + latin;
}

/**
 * Character/word counts of the clean (accept-all) projection — i.e. what the
 * document will contain once suggestions are accepted, so a pending deletion
 * stops counting immediately and a pending insertion counts right away.
 * Characters = Unicode code points of the text content (block breaks and
 * atoms don't count; CJK characters count one each, surrogate pairs such as
 * emoji also count one). Words follow `countWords` (CJK chars count one word
 * each, other scripts split on whitespace, block boundaries separate).
 */
export function countCleanText(doc: PMNode): { characters: number; words: number } {
  const clean = toClean(doc);
  let characters = 0;
  clean.descendants((n) => {
    if (n.isText && n.text) {
      // Code points, not UTF-16 units: an emoji or rare ideograph counts 1.
      for (const _ of n.text) characters += 1;
    }
    return undefined;
  });
  const text = clean.textBetween(0, clean.content.size, ' ');
  return { characters, words: countWords(text) };
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

/** Summarise every suggestion in the document, grouped by id, ordered by position. */
export function listSuggestions(doc: PMNode): SuggestionSummary[] {
  const byId = new Map<string, SuggestionSummary>();
  for (const u of collectUnits(doc)) {
    const existing = byId.get(u.id);
    if (existing) {
      existing.to = unitTo(u);
      if (u.kind === 'mark') existing.text += u.text;
      continue;
    }
    byId.set(u.id, {
      id: u.id,
      type: u.type,
      kind: u.kind,
      authorId: u.authorId,
      ts: u.ts,
      text: u.kind === 'mark' ? u.text : '',
      nodeType: u.nodeType,
      from: unitFrom(u),
      to: unitTo(u),
    });
  }
  for (const u of collectFormatUnits(doc)) {
    const existing = byId.get(u.id);
    if (existing) {
      existing.to = u.to;
      existing.text += u.text;
      continue;
    }
    byId.set(u.id, {
      id: u.id,
      type: 'format',
      kind: 'mark',
      authorId: u.authorId,
      ts: u.ts,
      text: u.text,
      formatAction: u.action,
      formatMark: u.markName,
      from: u.from,
      to: u.to,
    });
  }
  return [...byId.values()].sort((a, b) => a.from - b.from);
}

/** Whether the document currently carries any tracked suggestion. */
export function hasSuggestions(doc: PMNode): boolean {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (
      node.marks.some(
        (m) => m.type.name === INSERTION || m.type.name === DELETION || m.type.name === FORMAT_CHANGE,
      ) ||
      readNodeSuggestion(node)
    ) {
      found = true;
      return false;
    }
    return undefined;
  });
  return found;
}
