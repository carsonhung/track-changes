import { Plugin, PluginKey, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { Mapping, ReplaceStep, type StepMap } from '@tiptap/pm/transform';
import { insertionType, deletionType } from './marks';
import { isTrackableNode, readNodeSuggestion, SUGGESTION_NODE_ATTR } from './nodeAttrs';
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
 *
 * Out of scope by design of the mark model (documented): structural edits
 * (Enter splits, wraps via ReplaceAroundStep), formatting changes, and
 * multi-block deletions pass through untracked.
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

export function createRewriteSuggestingPlugin(): Plugin {
  return new Plugin({
    key: rewriteSuggestingKey,
    appendTransaction(transactions, _oldState, newState: EditorState) {
      if (!isSuggesting(newState)) return null;

      // Walk every step of every transaction (exempt ones still contribute
      // their maps so later positions resolve), collecting rewritable changes.
      const maps: StepMap[] = [];
      const entries: Array<{ step: ReplaceStep; before: PMNode; mapIndex: number }> = [];
      for (const tr of transactions) {
        const exempt = !tr.docChanged || isRewriteExempt(tr);
        tr.steps.forEach((step, i) => {
          maps.push(step.getMap());
          if (!exempt && step instanceof ReplaceStep) {
            entries.push({ step, before: tr.docs[i], mapIndex: maps.length - 1 });
          }
        });
      }
      if (!entries.length) return null;

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

      const schema = newState.schema;
      const insT = insertionType(schema);
      const delT = deletionType(schema);
      const authorId = getTrackChangesState(newState).authorId;
      const tr = newState.tr;

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
