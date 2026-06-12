import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Mark, type MarkType, type Node as PMNode } from '@tiptap/pm/model';
import { AddMarkStep, Mapping, RemoveMarkStep, ReplaceStep, type StepMap } from '@tiptap/pm/transform';
import { insertionType, deletionType } from './marks';
import { isTrackableNode, readNodeSuggestion, SUGGESTION_NODE_ATTR } from './nodeAttrs';
import { FORMAT_CHANGE, formatChangeType, readFormatChange, type FormatAction } from './formatChange';
import { isSuggesting, getTrackChangesState } from './state';
import { createSuggestionId } from './ids';

/**
 * The transaction-rewrite feature plugin — the safety net under the prop-based
 * feature plugins (text, clipboard). Editor props can't see every mutation:
 * IME composition syncs the DOM directly, drag-and-drop moves dispatch plain
 * transactions, and host code may call `insertText`/`delete` programmatically.
 * In suggesting mode this plugin rewrites any such untagged doc-changing
 * transaction into suggestion form via `appendTransaction`:
 *
 * - inserted inline content (text, inline atoms) → insertion-marked; inserted
 *   trackable block nodes → `suggestion: insertion` attribute
 * - deleted inline content → restored, deletion-marked (the author's own
 *   un-accepted insertions are dropped for real, so IME composition updates —
 *   which repeatedly replace the author's own composed text — stay clean)
 * - formatting toggles on existing text (`AddMarkStep` / `RemoveMarkStep`,
 *   e.g. Ctrl+B or a toolbar button) → `format_change` mark recording the
 *   toggle (P2f). Toggling the same mark back while the suggestion is pending
 *   cancels it instead of stacking a contradictory one. Formatting inside a
 *   pending insertion is NOT separately tracked — the insertion already
 *   carries its final formatting.
 *
 * Out of scope by design of the mark model (documented): structural edits
 * (Enter splits, wraps via ReplaceAroundStep) and multi-block deletions pass
 * through untracked. Block-type changes (heading, list wraps) are structural
 * and likewise pass through.
 *
 * The tagging contract: every transaction produced by this package's commands
 * carries `SUGGESTION_TX_META`, and undo/redo (`history$`) plus
 * `addToHistory: false` transactions (typically external sync) are exempt.
 */

/** Meta key marking a transaction as already suggestion-encoded (do not rewrite). */
export const SUGGESTION_TX_META = 'trackChanges$suggestion';

/** Tag a transaction as suggestion-encoded so the rewrite plugin leaves it alone. */
export function tagSuggestionTx(tr: Transaction): Transaction {
  return tr.setMeta(SUGGESTION_TX_META, true);
}

/** Whether a transaction is exempt from rewriting. */
export function isRewriteExempt(tr: Transaction): boolean {
  return (
    Boolean(tr.getMeta(SUGGESTION_TX_META)) ||
    Boolean(tr.getMeta('history$')) ||
    tr.getMeta('addToHistory') === false
  );
}

export const rewriteSuggestingKey = new PluginKey('trackChangesRewrite');

interface InlineChange {
  /** Inserted range in the final (new-state) document. */
  insFrom: number;
  insTo: number;
  /** Content the step removed, sliced from the doc as it was before the step. */
  deleted: Slice;
}

/**
 * If the slice is purely inline content (possibly wrapped in a single chain of
 * open ancestors, e.g. a text range sliced out of one paragraph), return that
 * inline fragment; otherwise null (multi-block / structural — not restorable
 * under the mark model).
 */
function inlineFragmentOf(slice: Slice): Fragment | null {
  if (slice.size === 0 || slice.openStart !== slice.openEnd) return null;
  let frag = slice.content;
  for (let depth = 0; depth < slice.openStart; depth++) {
    if (frag.childCount !== 1 || !frag.firstChild) return null;
    frag = frag.firstChild.content;
  }
  if (!frag.childCount) return null;
  let inline = true;
  frag.forEach((n) => {
    if (!n.isInline) inline = false;
  });
  return inline ? frag : null;
}

/** Contiguous [from, to) ranges of inline content in `doc` where the presence of `mark` equals `has`. */
function segmentsByMarkPresence(
  doc: PMNode,
  from: number,
  to: number,
  mark: MarkType,
  has: boolean,
): Array<{ from: number; to: number }> {
  const out: Array<{ from: number; to: number }> = [];
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText && !(node.isInline && node.isAtom)) return undefined;
    if ((mark.isInSet(node.marks) != null) !== has) return undefined;
    const f = Math.max(pos, from);
    const t = Math.min(pos + node.nodeSize, to);
    if (f >= t) return undefined;
    const last = out[out.length - 1];
    if (last && last.to === f) last.to = t;
    else out.push({ from: f, to: t });
    return undefined;
  });
  return out;
}

interface FormatChange {
  /** The toggled formatting mark. */
  markName: string;
  action: FormatAction;
  /** Range in the final (new-state) document. */
  from: number;
  to: number;
}

export function createRewriteSuggestingPlugin(): Plugin {
  return new Plugin({
    key: rewriteSuggestingKey,
    appendTransaction(transactions, _oldState, newState: EditorState) {
      if (!isSuggesting(newState)) return null;

      // Walk every step of every transaction (exempt ones still contribute
      // their maps so later positions resolve), collecting rewritable changes.
      const maps: StepMap[] = [];
      const entries: Array<{ step: ReplaceStep; before: PMNode; mapIndex: number }> = [];
      const markEntries: Array<{
        step: AddMarkStep | RemoveMarkStep;
        before: PMNode;
        mapIndex: number;
      }> = [];
      for (const tr of transactions) {
        const exempt = !tr.docChanged || isRewriteExempt(tr);
        tr.steps.forEach((step, i) => {
          maps.push(step.getMap());
          if (exempt) return;
          if (step instanceof ReplaceStep) {
            entries.push({ step, before: tr.docs[i], mapIndex: maps.length - 1 });
          } else if (
            (step instanceof AddMarkStep || step instanceof RemoveMarkStep) &&
            step.mark.type.name !== 'insertion' &&
            step.mark.type.name !== 'deletion' &&
            step.mark.type.name !== FORMAT_CHANGE
          ) {
            markEntries.push({ step, before: tr.docs[i], mapIndex: maps.length - 1 });
          }
        });
      }
      if (!entries.length && !markEntries.length) return null;

      const changes: InlineChange[] = [];
      for (const entry of entries) {
        const after = new Mapping(maps.slice(entry.mapIndex + 1));
        entry.step.getMap().forEach((fromA, toA, fromB, toB) => {
          changes.push({
            insFrom: after.map(fromB, 1),
            insTo: after.map(toB, -1),
            deleted: entry.before.slice(fromA, toA),
          });
        });
      }

      // Formatting toggles: record only segments whose mark presence actually
      // changed (computed against the doc as it was before the step), so a
      // reject restores exactly the prior formatting.
      const formatChanges: FormatChange[] = [];
      for (const entry of markEntries) {
        const adding = entry.step instanceof AddMarkStep;
        const after = new Mapping(maps.slice(entry.mapIndex + 1));
        const segments = segmentsByMarkPresence(
          entry.before,
          entry.step.from,
          entry.step.to,
          entry.step.mark.type,
          !adding, // Add affects segments that lacked the mark; Remove those that had it
        );
        for (const seg of segments) {
          formatChanges.push({
            markName: entry.step.mark.type.name,
            action: adding ? 'add' : 'remove',
            from: after.map(seg.from, 1),
            to: after.map(seg.to, -1),
          });
        }
      }

      const schema = newState.schema;
      const insT = insertionType(schema);
      const delT = deletionType(schema);
      const authorId = getTrackChangesState(newState).authorId;
      const tr = newState.tr;

      // Apply format-change suggestions first: every operation here is
      // size-stable, so the content rewrites below keep their coordinates.
      const fmtT = formatChangeType(schema);
      for (const fc of formatChanges) {
        if (fc.to <= fc.from) continue;
        const attrs = {
          id: createSuggestionId(),
          authorId,
          ts: Date.now(),
          action: fc.action,
          markName: fc.markName,
        };
        const adds: Array<{ from: number; to: number }> = [];
        const cancels: Array<{ from: number; to: number; mark: Mark }> = [];
        tr.doc.nodesBetween(fc.from, fc.to, (node, pos) => {
          if (!node.isText && !(node.isInline && node.isAtom)) return undefined;
          const from = Math.max(pos, fc.from);
          const to = Math.min(pos + node.nodeSize, fc.to);
          if (from >= to) return undefined;
          // Formatting inside a pending insertion is part of the insertion.
          if (node.marks.some((m) => m.type === insT)) return undefined;
          const existing = node.marks
            .map((m) => ({ mark: m, fc: readFormatChange(m) }))
            .filter((e) => e.fc?.markName === fc.markName);
          const opposite = existing.find((e) => e.fc!.action !== fc.action);
          if (opposite) {
            // Toggled back while pending → cancel the earlier suggestion.
            cancels.push({ from, to, mark: opposite.mark });
            return undefined;
          }
          if (existing.length) return undefined; // same toggle already pending
          adds.push({ from, to });
          return undefined;
        });
        for (const c of cancels) tr.removeMark(c.from, c.to, c.mark);
        for (const a of adds) tr.addMark(a.from, a.to, fmtT.create(attrs));
      }

      // Apply in descending document order so restores don't shift later changes.
      changes.sort((a, b) => b.insFrom - a.insFrom);
      for (const change of changes) {
        // 1. Mark freshly inserted content (size-stable; collect then apply).
        if (change.insTo > change.insFrom) {
          const attrs = { id: createSuggestionId(), authorId, ts: Date.now() };
          const markRanges: Array<{ from: number; to: number }> = [];
          const nodeUpdates: Array<{ pos: number; attrs: Record<string, unknown> }> = [];
          tr.doc.nodesBetween(change.insFrom, change.insTo, (node, pos) => {
            if (node.isText || (node.isInline && node.isAtom)) {
              if (node.marks.some((m) => m.type === insT || m.type === delT)) return;
              const from = Math.max(pos, change.insFrom);
              const to = Math.min(pos + node.nodeSize, change.insTo);
              if (from < to) markRanges.push({ from, to });
              return;
            }
            if (
              isTrackableNode(node) &&
              pos >= change.insFrom &&
              pos + node.nodeSize <= change.insTo &&
              !readNodeSuggestion(node)
            ) {
              nodeUpdates.push({ pos, attrs: node.attrs as Record<string, unknown> });
              return false; // the whole node is the suggestion; skip its children
            }
            return undefined;
          });
          for (const r of markRanges) tr.addMark(r.from, r.to, insT.create(attrs));
          for (const u of nodeUpdates) {
            tr.setNodeMarkup(u.pos, undefined, {
              ...u.attrs,
              [SUGGESTION_NODE_ATTR]: { type: 'insertion', ...attrs },
            });
          }
        }

        // 2. Restore deleted inline content, deletion-marked, ahead of the
        //    insertion point (Word-style: struck-out original, then new text).
        const frag = inlineFragmentOf(change.deleted);
        if (!frag) continue;
        const $ins = tr.doc.resolve(Math.min(change.insFrom, tr.doc.content.size));
        if (!$ins.parent.inlineContent) continue;
        const attrs = { id: createSuggestionId(), authorId, ts: Date.now() };
        const restored: PMNode[] = [];
        frag.forEach((node) => {
          const own = node.marks.find(
            (m) => m.type === insT && (m.attrs.authorId ?? null) === (authorId ?? null),
          );
          if (own) return; // author's own un-accepted insertion → stays deleted
          if (node.marks.some((m) => m.type === delT)) {
            restored.push(node); // already a suggested deletion → restore as-is
            return;
          }
          restored.push(node.mark(delT.create(attrs).addToSet(node.marks)));
        });
        if (restored.length) tr.insert($ins.pos, Fragment.from(restored));
      }

      if (!tr.docChanged) return null;
      return tagSuggestionTx(tr);
    },
  });
}
