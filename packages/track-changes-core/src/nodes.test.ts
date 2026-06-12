import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createExtendedSuggestionSchema } from './schema';
import { createSuggestingPlugin } from './plugin';
import { suggestInsertNode, suggestDeleteNode } from './commands';
import { toClean, toRejected, listSuggestions, hasSuggestions } from './clean';
import { readNodeSuggestion } from './nodeAttrs';

const schema = createExtendedSuggestionSchema();

function stateWith(doc: PMNode, authorId = 'A') {
  return EditorState.create({
    schema,
    doc,
    plugins: [createSuggestingPlugin({ suggesting: true, authorId })],
  });
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  cmd(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return next;
}

const para = (...inline: PMNode[]) => schema.node('paragraph', null, inline);
const img = (src = 'a.png') => schema.node('image', { src });
const figure = (src = 'fig.png', suggestion: unknown = null) =>
  schema.node('figure', { src, suggestion });
const cell = (text: string) => schema.node('tableCell', null, [schema.text(text)]);
const rowOf = (text: string, suggestion: unknown = null) =>
  schema.node('tableRow', { suggestion }, [cell(text)]);

function names(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((n) => {
    out.push(n.isText ? `t:${n.text}` : n.type.name);
    return undefined;
  });
  return out;
}

describe('inline atom (image) suggestions via mark', () => {
  it('suggestInsertNode marks an inline image as an insertion; accept keeps, reject drops', () => {
    let state = stateWith(schema.node('doc', null, [para(schema.text('hi '))]));
    // Caret at end of "hi " (inside paragraph).
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, state.doc.content.size - 1)));
    state = run(state, suggestInsertNode(img('x.png')));

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', kind: 'mark', nodeType: 'image' });

    expect(names(toClean(state.doc))).toContain('image'); // accepted: image stays
    expect(names(toRejected(state.doc))).not.toContain('image'); // rejected: image gone
    expect(hasSuggestions(toClean(state.doc))).toBe(false);
  });

  it('suggestDeleteNode marks an existing inline image deleted; accept removes, reject keeps', () => {
    const docNode = schema.node('doc', null, [para(schema.text('a'), img('y.png'), schema.text('b'))]);
    let state = stateWith(docNode);
    const imgPos = 2; // doc>para(1) + text 'a'(1) => image at 2
    expect(state.doc.nodeAt(imgPos)?.type.name).toBe('image');
    state = run(state, suggestDeleteNode(imgPos));

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'deletion', kind: 'mark', nodeType: 'image' });

    expect(names(toClean(state.doc))).not.toContain('image'); // accepted deletion: gone
    expect(names(toRejected(state.doc))).toContain('image'); // rejected deletion: kept
  });
});

describe('block node (figure) suggestions via node attribute', () => {
  it('suggestInsertNode tags a block figure as insertion; accept strips attr, reject deletes', () => {
    let state = stateWith(schema.node('doc', null, [para(schema.text('p'))]));
    state = state.apply(state.tr.setSelection(SelectionAtEnd(state.doc)));
    state = run(state, suggestInsertNode(figure('z.png')));

    const inserted = findFigure(state.doc);
    expect(readNodeSuggestion(inserted!)?.type).toBe('insertion');

    const accepted = toClean(state.doc);
    expect(findFigure(accepted)).toBeTruthy();
    expect(readNodeSuggestion(findFigure(accepted)!)).toBeNull();

    expect(findFigure(toRejected(state.doc))).toBeUndefined();
  });

  it('round-trips a node-attr suggestion through JSON', () => {
    const docNode = schema.node('doc', null, [
      para(schema.text('keep')),
      figure('q.png', { type: 'insertion', id: 'fig-1', authorId: 'A', ts: 1 }),
    ]);
    const round = schema.nodeFromJSON(docNode.toJSON());
    expect(toClean(round).toJSON()).toEqual(toClean(docNode).toJSON());
    expect(listSuggestions(round).map((s) => s.id)).toEqual(['fig-1']);
  });
});

describe('table row suggestions via node attribute', () => {
  it('suggestDeleteNode marks a row deleted; accept removes the row, reject keeps it', () => {
    const table = schema.node('table', null, [rowOf('r1'), rowOf('r2')]);
    const docNode = schema.node('doc', null, [table]);
    let state = stateWith(docNode);

    // Locate the second row's position.
    let rowPos = -1;
    let seen = 0;
    state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableRow') {
        seen += 1;
        if (seen === 2) rowPos = pos;
      }
      return undefined;
    });
    expect(rowPos).toBeGreaterThan(0);

    state = run(state, suggestDeleteNode(rowPos));
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'deletion', kind: 'node', nodeType: 'tableRow' });

    expect(countRows(toClean(state.doc))).toBe(1); // accepted: row removed
    expect(countRows(toRejected(state.doc))).toBe(2); // rejected: row kept
    expect(hasSuggestions(toClean(state.doc))).toBe(false);
  });

  it("real-deletes the author's own un-accepted inserted row", () => {
    const table = schema.node('table', null, [
      rowOf('keep'),
      rowOf('mine', { type: 'insertion', id: 'row-1', authorId: 'A', ts: 1 }),
    ]);
    let state = stateWith(schema.node('doc', null, [table]), 'A');
    let rowPos = -1;
    let seen = 0;
    state.doc.descendants((n, pos) => {
      if (n.type.name === 'tableRow') {
        seen += 1;
        if (seen === 2) rowPos = pos;
      }
      return undefined;
    });
    state = run(state, suggestDeleteNode(rowPos));
    expect(countRows(state.doc)).toBe(1); // removed for real, not deletion-marked
    expect(hasSuggestions(state.doc)).toBe(false);
  });
});

// --- helpers -----------------------------------------------------------------

function SelectionAtEnd(doc: PMNode) {
  return TextSelection.create(doc, doc.content.size - 1);
}

function findFigure(doc: PMNode): PMNode | undefined {
  let found: PMNode | undefined;
  doc.descendants((n) => {
    if (n.type.name === 'figure') found = n;
    return undefined;
  });
  return found;
}

function countRows(doc: PMNode): number {
  let n = 0;
  doc.descendants((node) => {
    if (node.type.name === 'tableRow') n += 1;
    return undefined;
  });
  return n;
}
