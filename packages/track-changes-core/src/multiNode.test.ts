import { describe, it, expect } from 'vitest';
import { EditorState, type Command, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createExtendedSuggestionSchema } from './schema';
import { createSuggestingPlugins } from './plugin';
import { suggestInsertNodes, suggestDeleteNodes } from './commands';
import {
  toClean,
  toRejected,
  listSuggestions,
  countCleanText,
  countWords,
  hasSuggestions,
} from './clean';

const schema = createExtendedSuggestionSchema();

function stateWith(doc: PMNode, authorId = 'A') {
  return EditorState.create({
    schema,
    doc,
    plugins: createSuggestingPlugins({ suggesting: true, authorId }),
  });
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  cmd(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return next;
}

const para = (text: string) => schema.node('paragraph', null, [schema.text(text)]);
const cell = (text: string) => schema.node('tableCell', null, [schema.text(text)]);
const row = (...cells: PMNode[]) => schema.node('tableRow', null, cells);

/** Positions of every cell at a given column index, per row, in doc order. */
function columnCellPositions(doc: PMNode, colIndex: number): number[] {
  const out: number[] = [];
  doc.descendants((n, pos) => {
    if (n.type.name !== 'tableRow') return undefined;
    let cellPos = pos + 1;
    for (let i = 0; i < n.childCount; i++) {
      if (i === colIndex) out.push(cellPos);
      cellPos += n.child(i).nodeSize;
    }
    return false;
  });
  return out;
}

function columnsPerRow(doc: PMNode): number[] {
  const out: number[] = [];
  doc.descendants((n) => {
    if (n.type.name === 'tableRow') out.push(n.childCount);
    return undefined;
  });
  return out;
}

describe('suggestInsertNodes (shared-id group, e.g. a table column)', () => {
  it('inserts one cell per row as a single atomic suggestion', () => {
    const table = schema.node('table', null, [row(cell('a1')), row(cell('b1'))]);
    let state = stateWith(schema.node('doc', null, [table]));

    // Insert a new cell after column 0 in each row.
    const afterCol0 = columnCellPositions(state.doc, 0).map((p) => {
      const node = state.doc.nodeAt(p)!;
      return { node: cell('new'), at: p + node.nodeSize };
    });
    state = run(state, suggestInsertNodes(afterCol0));

    // One suggestion id covering both cells.
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', kind: 'node', nodeType: 'tableCell' });

    expect(columnsPerRow(state.doc)).toEqual([2, 2]);
    expect(columnsPerRow(toClean(state.doc))).toEqual([2, 2]); // accepted: column stays
    expect(columnsPerRow(toRejected(state.doc))).toEqual([1, 1]); // rejected: column gone
  });
});

describe('suggestDeleteNodes (shared-id group)', () => {
  it('marks a whole column deleted as one suggestion; accept removes, reject keeps', () => {
    const table = schema.node('table', null, [
      row(cell('a1'), cell('a2')),
      row(cell('b1'), cell('b2')),
    ]);
    let state = stateWith(schema.node('doc', null, [table]));

    state = run(state, suggestDeleteNodes(columnCellPositions(state.doc, 1)));

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'deletion', kind: 'node', nodeType: 'tableCell' });

    expect(columnsPerRow(toClean(state.doc))).toEqual([1, 1]); // accepted: column removed
    expect(columnsPerRow(toRejected(state.doc))).toEqual([2, 2]); // rejected: column kept
    expect(hasSuggestions(toClean(state.doc))).toBe(false);
  });

  it("real-deletes the author's own un-accepted inserted cells instead of marking", () => {
    const table = schema.node('table', null, [row(cell('a1')), row(cell('b1'))]);
    let state = stateWith(schema.node('doc', null, [table]), 'A');

    // Author A suggests a new column…
    const inserts = columnCellPositions(state.doc, 0).map((p) => {
      const node = state.doc.nodeAt(p)!;
      return { node: cell('mine'), at: p + node.nodeSize };
    });
    state = run(state, suggestInsertNodes(inserts));
    expect(columnsPerRow(state.doc)).toEqual([2, 2]);

    // …then deletes it again: cells vanish for real, no suggestion left.
    state = run(state, suggestDeleteNodes(columnCellPositions(state.doc, 1)));
    expect(columnsPerRow(state.doc)).toEqual([1, 1]);
    expect(hasSuggestions(state.doc)).toBe(false);
  });
});

describe('countCleanText', () => {
  it('counts the accept-all projection, not the tracked markup', () => {
    // "hello" (5 chars) + " world" pending insertion (6 chars incl. space).
    const docNode = schema.node('doc', null, [
      schema.node('paragraph', null, [
        schema.text('hello'),
        schema
          .text(' world')
          .mark([schema.marks.insertion.create({ id: 'i1', authorId: 'A', ts: 1 })]),
        schema
          .text(' gone')
          .mark([schema.marks.deletion.create({ id: 'd1', authorId: 'A', ts: 2 })]),
      ]),
    ]);
    expect(countCleanText(docNode)).toEqual({ characters: 11, words: 2 });
  });

  it('separates words at block boundaries and ignores empty docs', () => {
    const two = schema.node('doc', null, [para('one'), para('two three')]);
    expect(countCleanText(two)).toEqual({ characters: 12, words: 3 });
    const empty = schema.node('doc', null, [schema.node('paragraph')]);
    expect(countCleanText(empty)).toEqual({ characters: 0, words: 0 });
  });

  it('counts each CJK character as one word (MS Word 字数 convention)', () => {
    // 7 Chinese characters, no spaces — must not collapse into "1 word".
    const zh = schema.node('doc', null, [para('本項目進展順利')]);
    expect(countCleanText(zh)).toEqual({ characters: 7, words: 7 });

    // Mixed Chinese + Latin: 7 CJK chars + 2 English words.
    const mixed = schema.node('doc', null, [para('本项目使用 machine learning 方法')]);
    expect(countCleanText(mixed).words).toBe(9);

    // Japanese kana counts per character too; Korean splits on spaces.
    expect(countWords('ひらがな')).toBe(4);
    expect(countWords('안녕하세요 세계')).toBe(2);
  });

  it('counts emoji and surrogate-pair characters as one character', () => {
    const doc = schema.node('doc', null, [para('a😀b')]);
    expect(countCleanText(doc).characters).toBe(3);
  });
});

describe('countWords (plain string)', () => {
  it('handles punctuation around CJK without counting it', () => {
    // CJK punctuation (，。) is not in the word ranges and carries no spaces;
    // it merges adjacent Latin runs only if no whitespace separates them.
    expect(countWords('進展順利，成果豐碩。')).toBe(8);
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });
});
