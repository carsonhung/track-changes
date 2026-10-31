import type { Editor } from '@tiptap/vue-3';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  isSuggesting,
  suggestInsertNode,
  suggestInsertNodes,
  suggestDeleteNode,
  suggestDeleteNodes,
} from 'track-changes-core';

/**
 * Shared mutation helpers for feature plugins. Track-changes awareness lives
 * here: in suggesting mode every feature edit routes through the core's
 * suggestion commands (so it is reviewable like any other change); in plain
 * editing mode the same edit applies directly. The rewrite plugin is inert
 * while suggesting is off, so direct dispatches need no tagging.
 */

/** Insert a node — tracked insertion when suggesting, plain insert otherwise. */
export function featureInsertNode(editor: Editor, node: PMNode, at?: number): void {
  if (isSuggesting(editor.state)) {
    suggestInsertNode(node, at)(editor.state, (tr) => editor.view.dispatch(tr));
    return;
  }
  const tr = editor.state.tr;
  if (at !== undefined) tr.insert(at, node);
  else tr.replaceSelectionWith(node, false);
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * Insert several nodes at explicit positions in one operation. Suggesting mode
 * groups them under a single suggestion id (one atomic accept/reject — e.g. a
 * table column); editing mode applies one plain transaction. Positions refer
 * to the current document.
 */
export function featureInsertNodes(editor: Editor, inserts: Array<{ node: PMNode; at: number }>): void {
  if (!inserts.length) return;
  if (isSuggesting(editor.state)) {
    suggestInsertNodes(inserts)(editor.state, (tr) => editor.view.dispatch(tr));
    return;
  }
  const tr = editor.state.tr;
  for (const { node, at } of [...inserts].sort((a, b) => b.at - a.at)) tr.insert(at, node);
  editor.view.dispatch(tr.scrollIntoView());
}

/**
 * Delete the block nodes at `positions` in one operation. Suggesting mode
 * marks them as a single grouped deletion suggestion; editing mode deletes
 * them for real (descending so positions stay valid).
 */
export function featureDeleteNodes(editor: Editor, positions: number[]): void {
  if (!positions.length) return;
  if (isSuggesting(editor.state)) {
    suggestDeleteNodes(positions)(editor.state, (tr) => editor.view.dispatch(tr));
    return;
  }
  const tr = editor.state.tr;
  for (const pos of [...positions].sort((a, b) => b - a)) {
    const node = editor.state.doc.nodeAt(pos);
    if (node) tr.delete(pos, pos + node.nodeSize);
  }
  editor.view.dispatch(tr.scrollIntoView());
}

/** Delete the node at `pos` — tracked deletion when suggesting, real delete otherwise. */
export function featureDeleteNode(editor: Editor, pos: number): void {
  if (isSuggesting(editor.state)) {
    suggestDeleteNode(pos)(editor.state, (tr) => editor.view.dispatch(tr));
    return;
  }
  const node = editor.state.doc.nodeAt(pos);
  if (!node) return;
  editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize).scrollIntoView());
}

/** Open the browser file picker; resolves null if the user cancels silently. */
export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    };
    document.body.appendChild(input);
    input.click();
  });
}
