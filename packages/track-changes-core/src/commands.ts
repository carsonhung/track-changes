import { TextSelection, type Command, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { MarkType } from '@tiptap/pm/model';
import { INSERTION, insertionType, deletionType } from './marks';
import { createSuggestionId } from './ids';
import { trackChangesKey, getTrackChangesState } from './state';
import { acceptOn, rejectOn, acceptAllOn, rejectAllOn } from './clean';

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
 * Mark [from,to] as a suggested deletion. Content that is the current author's
 * own (not-yet-accepted) insertion is removed for real instead of being
 * deletion-marked, so authors can freely undo their own suggested additions.
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
    if (!node.isText) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    if (start >= end) return;
    const own = node.marks.find(
      (m) => m.type === insType && (m.attrs.authorId ?? null) === (authorId ?? null),
    );
    (own ? realDeletes : markDeletes).push({ from: start, to: end });
  });

  if (markDeletes.length) {
    const id = createSuggestionId();
    const mark = delType.create({ id, authorId, ts: Date.now() });
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
  if (dispatch) dispatch(tr.scrollIntoView());
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
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }
  if (from === 0) return false;
  markRangeDeleted(tr, from - 1, from, insType, delType, authorId);
  tr.setSelection(TextSelection.create(tr.doc, Math.max(0, from - 1)));
  if (dispatch) dispatch(tr.scrollIntoView());
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
    if (dispatch) dispatch(tr.scrollIntoView());
    return true;
  }
  if (from >= state.doc.content.size) return false;
  markRangeDeleted(tr, from, from + 1, insType, delType, authorId);
  tr.setSelection(TextSelection.create(tr.doc, from));
  if (dispatch) dispatch(tr.scrollIntoView());
  return true;
};

// ---------------------------------------------------------------------------
// Accept / reject commands (thin wrappers over the Transform mutators)
// ---------------------------------------------------------------------------

export function acceptSuggestion(id: string): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    acceptOn(tr, id);
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function rejectSuggestion(id: string): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    rejectOn(tr, id);
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function acceptAllSuggestions(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    acceptAllOn(tr);
    if (dispatch) dispatch(tr);
    return true;
  };
}

export function rejectAllSuggestions(): Command {
  return (state, dispatch) => {
    const tr = state.tr;
    rejectAllOn(tr);
    if (dispatch) dispatch(tr);
    return true;
  };
}
