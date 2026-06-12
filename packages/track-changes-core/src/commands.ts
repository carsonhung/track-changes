import { TextSelection, Selection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { MarkType, Node as PMNode, Schema } from '@tiptap/pm/model';
import { INSERTION, insertionType, deletionType } from './marks';
import { SUGGESTION_NODE_ATTR, isTrackableNode, readNodeSuggestion } from './nodeAttrs';
import { createSuggestionId } from './ids';
import { trackChangesKey, getTrackChangesState } from './state';
import { acceptOn, rejectOn, acceptAllOn, rejectAllOn } from './clean';
import { tagSuggestionTx } from './rewrite';

type Dispatch = ((tr: Transaction) => void) | undefined;

// ---------------------------------------------------------------------------
// Mode / author
// ---------------------------------------------------------------------------

export function setSuggesting(on: boolean): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(trackChangesKey, { suggesting: on }));
    return true;
  };
}

export function setSuggestionAuthor(authorId: string | null): Command {
  return (state, dispatch) => {
    if (dispatch) dispatch(state.tr.setMeta(trackChangesKey, { authorId }));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Shared low-level helpers (operate on a Transaction in progress)
// ---------------------------------------------------------------------------

/**
 * Find an existing same-author deletion suggestion immediately adjacent to
 * [from,to] so consecutive Backspace/Delete presses merge into one suggestion
 * (mirroring how consecutive typing merges insertions via `insertionAttrsAt`).
 */
function adjacentDeletionAttrs(
  tr: Transaction,
  from: number,
  to: number,
  delType: MarkType,
  authorId: string | null,
): { id: string; authorId: string | null; ts: number } | null {
  for (const pos of [to, Math.max(0, from - 1)]) {
    const node = tr.doc.nodeAt(pos);
    const prev = node?.marks.find(
      (m) => m.type === delType && (m.attrs.authorId ?? null) === (authorId ?? null),
    );
    if (prev) return { id: String(prev.attrs.id), authorId, ts: Number(prev.attrs.ts) || Date.now() };
  }
  return null;
}

/**
 * Mark [from,to] as a suggested deletion. Three cases per segment:
 * - already deletion-marked (any author) → skipped, so re-deleting over an
 *   existing suggestion never re-attributes or fragments it
 * - the current author's own (not-yet-accepted) insertion → removed for real,
 *   so authors can freely undo their own suggested additions
 * - everything else → deletion-marked, reusing the id of an adjacent
 *   same-author deletion so consecutive presses form one suggestion
 * `addMark` is size-stable, so the real deletes (applied last, descending) keep
 * their original positions.
 */
function markRangeDeleted(
  tr: Transaction,
  from: number,
  to: number,
  insType: MarkType,
  delType: MarkType,
  authorId: string | null,
): void {
  const realDeletes: Array<{ from: number; to: number }> = [];
  const markDeletes: Array<{ from: number; to: number }> = [];
  tr.doc.nodesBetween(from, to, (node, pos) => {
    // Track text and inline atoms (e.g. inline images). Block nodes are handled
    // via the node-attribute path (suggestDeleteNode), not this inline sweep.
    if (!node.isText && !(node.isInline && node.isAtom)) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    if (start >= end) return;
    if (node.marks.some((m) => m.type === delType)) return; // already a suggested deletion
    const own = node.marks.find(
      (m) => m.type === insType && (m.attrs.authorId ?? null) === (authorId ?? null),
    );
    (own ? realDeletes : markDeletes).push({ from: start, to: end });
  });

  if (markDeletes.length) {
    const attrs =
      adjacentDeletionAttrs(tr, from, to, delType, authorId) ??
      { id: createSuggestionId(), authorId, ts: Date.now() };
    const mark = delType.create(attrs);
    for (const r of markDeletes) tr.addMark(r.from, r.to, mark);
  }
  realDeletes.sort((a, b) => b.from - a.from).forEach((r) => tr.delete(r.from, r.to));
}

/**
 * Reuse the insertion id of immediately-preceding insertion content by the same
 * author so consecutive typing forms one suggestion; otherwise mint a new id.
 */
function insertionAttrsAt(
  state: EditorState,
  pos: number,
  authorId: string | null,
): { id: string; authorId: string | null; ts: number } {
  if (pos > 0) {
    const marks = state.doc.resolve(pos).marks();
    const prev = marks.find(
      (m) => m.type.name === INSERTION && (m.attrs.authorId ?? null) === (authorId ?? null),
    );
    if (prev) return { id: String(prev.attrs.id), authorId, ts: Number(prev.attrs.ts) || Date.now() };
  }
  return { id: createSuggestionId(), authorId, ts: Date.now() };
}

/** Core insert: mark any replaced range deleted, then insert `text` as an insertion. */
function insertSuggestion(
  state: EditorState,
  dispatch: Dispatch,
  from: number,
  to: number,
  text: string,
): boolean {
  if (!text) return false;
  const insType = insertionType(state.schema);
  const delType = deletionType(state.schema);
  const authorId = getTrackChangesState(state).authorId;
  const tr = state.tr;

  if (from < to) markRangeDeleted(tr, from, to, insType, delType, authorId);

  // Marking is size-stable, so `to` is still the correct insertion point.
  const attrs = insertionAttrsAt(state, to, authorId);
  tr.insert(to, state.schema.text(text, [insType.create(attrs)]));
  const caret = to + text.length;
  tr.setSelection(TextSelection.create(tr.doc, caret));
  if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
  return true;
}

// ---------------------------------------------------------------------------
// Public editing commands (used by the plugin's input handlers + adapters)
// ---------------------------------------------------------------------------

/** Insert text as a suggestion at the current selection. */
export function suggestInsertText(text: string): Command {
  return (state, dispatch) => {
    const { from, to } = state.selection;
    return insertSuggestion(state, dispatch, from, to, text);
  };
}

/** Insert text as a suggestion at an explicit range (used by handleTextInput). */
export function suggestInsertTextAt(from: number, to: number, text: string): Command {
  return (state, dispatch) => insertSuggestion(state, dispatch, from, to, text);
}

/** Backspace in suggesting mode: mark the selection (or preceding char) deleted. */
export const suggestDeleteBackward: Command = (state, dispatch) => {
  const insType = insertionType(state.schema);
  const delType = deletionType(state.schema);
  const authorId = getTrackChangesState(state).authorId;
  const { empty, from, to } = state.selection;
  const tr = state.tr;

  if (!empty) {
    markRangeDeleted(tr, from, to, insType, delType, authorId);
    tr.setSelection(TextSelection.create(tr.doc, from));
    if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
    return true;
  }
  if (from === 0) return false;
  markRangeDeleted(tr, from - 1, from, insType, delType, authorId);
  tr.setSelection(TextSelection.create(tr.doc, Math.max(0, from - 1)));
  if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
  return true;
};

/** Delete in suggesting mode: mark the selection (or following char) deleted. */
export const suggestDeleteForward: Command = (state, dispatch) => {
  const insType = insertionType(state.schema);
  const delType = deletionType(state.schema);
  const authorId = getTrackChangesState(state).authorId;
  const { empty, from, to } = state.selection;
  const tr = state.tr;

  if (!empty) {
    markRangeDeleted(tr, from, to, insType, delType, authorId);
    tr.setSelection(TextSelection.create(tr.doc, from));
    if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
    return true;
  }
  if (from >= state.doc.content.size) return false;
  markRangeDeleted(tr, from, from + 1, insType, delType, authorId);
  tr.setSelection(TextSelection.create(tr.doc, from));
  if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
  return true;
};

// ---------------------------------------------------------------------------
// Node-level suggestions (atoms + block/structural nodes)
//
// Inline atoms (e.g. inline images) carry the insertion/deletion *mark* like
// text. Block / structural nodes (block image, tableRow) cannot carry an inline
// mark, so they carry the `suggestion` node *attribute* instead. Both are
// document data and resolved uniformly by the accept/reject engine.
// ---------------------------------------------------------------------------

/** Wrap a node as a tracked insertion (inline → mark; block → `suggestion` attr). */
function trackInserted(schema: Schema, node: PMNode, authorId: string | null): PMNode {
  const attrs = { id: createSuggestionId(), authorId, ts: Date.now() };
  if (node.isInline) {
    return node.mark(insertionType(schema).create(attrs).addToSet(node.marks));
  }
  if (!isTrackableNode(node)) {
    throw new Error(
      `track-changes: node "${node.type.name}" cannot be suggest-inserted — it does not declare the "${SUGGESTION_NODE_ATTR}" attribute`,
    );
  }
  return node.type.create(
    { ...node.attrs, [SUGGESTION_NODE_ATTR]: { type: 'insertion', ...attrs } },
    node.content,
    node.marks,
  );
}

/**
 * Insert a node as a tracked insertion. Use for atoms (inline image) and
 * trackable block nodes (block image, table row). With no `at`, inserts at the
 * current selection and a non-empty selection is first marked deleted (mirroring
 * text replacement). Pass `at` to insert at an explicit position (e.g. a new
 * table row at the end of a table).
 */
export function suggestInsertNode(node: PMNode, at?: number): Command {
  return (state, dispatch) => {
    const insType = insertionType(state.schema);
    const delType = deletionType(state.schema);
    const authorId = getTrackChangesState(state).authorId;
    const { from, to } = state.selection;
    const tr = state.tr;

    const pos = at ?? to;
    if (at === undefined && from < to) markRangeDeleted(tr, from, to, insType, delType, authorId);
    const tracked = trackInserted(state.schema, node, authorId);
    tr.insert(pos, tracked);
    tr.setSelection(Selection.near(tr.doc.resolve(pos + tracked.nodeSize)));
    if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
    return true;
  };
}

/**
 * Suggest deletion of the node at `pos` (keep it, mark it deleted). An inline
 * node is marked via the deletion mark; a block/structural node toggles its
 * `suggestion` attribute. The author's own not-yet-accepted insertion is removed
 * for real instead, so authors can undo their own suggested additions.
 */
export function suggestDeleteNode(pos: number): Command {
  return (state, dispatch) => {
    const node = state.doc.nodeAt(pos);
    if (!node) return false;
    const insType = insertionType(state.schema);
    const delType = deletionType(state.schema);
    const authorId = getTrackChangesState(state).authorId;
    const tr = state.tr;

    if (node.isInline) {
      markRangeDeleted(tr, pos, pos + node.nodeSize, insType, delType, authorId);
      if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
      return true;
    }

    if (!isTrackableNode(node)) return false;
    const existing = readNodeSuggestion(node);
    if (existing?.type === 'deletion') return false; // already marked deleted
    if (existing?.type === 'insertion' && (existing.authorId ?? null) === (authorId ?? null)) {
      tr.delete(pos, pos + node.nodeSize); // own un-accepted insertion → real delete
    } else {
      tr.setNodeMarkup(pos, undefined, {
        ...node.attrs,
        [SUGGESTION_NODE_ATTR]: { type: 'deletion', id: createSuggestionId(), authorId, ts: Date.now() },
      });
    }
    if (dispatch) dispatch(tagSuggestionTx(tr.scrollIntoView()));
    return true;
  };
}

// ---------------------------------------------------------------------------
// Accept / reject commands (thin wrappers over the Transform mutators)
// ---------------------------------------------------------------------------

export function acceptSuggestion(id: string): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    acceptOn(tr, id);
    if (dispatch) dispatch(tagSuggestionTx(tr));
    return true;
  };
}

export function rejectSuggestion(id: string): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    rejectOn(tr, id);
    if (dispatch) dispatch(tagSuggestionTx(tr));
    return true;
  };
}

export function acceptAllSuggestions(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    acceptAllOn(tr);
    if (dispatch) dispatch(tagSuggestionTx(tr));
    return true;
  };
}

export function rejectAllSuggestions(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    rejectAllOn(tr);
    if (dispatch) dispatch(tagSuggestionTx(tr));
    return true;
  };
}
