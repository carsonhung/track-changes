import { describe, it, expect } from 'vitest';
import { EditorState, type Command, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createBasicSuggestionSchema } from './schema';
import { createSuggestingPlugins } from './plugin';
import { tagSuggestionTx } from './rewrite';
import { suggestInsertTextAt } from './commands';
import { listSuggestions, toClean, toRejected } from './clean';

// The rewrite plugin is exercised through `EditorState.apply`, which runs
// `appendTransaction` — exactly the path real editor dispatches take.

const schema = createBasicSuggestionSchema();

function para(...inline: PMNode[]) {
  return schema.node('paragraph', null, inline);
}

function stateWith(text: string, authorId = 'A', suggesting = true) {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, [para(...(text ? [schema.text(text)] : []))]),
    plugins: createSuggestingPlugins({ suggesting, authorId }),
  });
}

function run(state: EditorState, cmd: Command): EditorState {
  let next = state;
  cmd(state, (tr: Transaction) => {
    next = state.apply(tr);
  });
  return next;
}

function textOf(node: PMNode): string {
  return node.textBetween(0, node.content.size, '');
}

describe('rewrite plugin — untagged transactions become suggestions', () => {
  it('rewrites a plain text insertion into a tracked insertion', () => {
    let state = stateWith('Hello');
    state = state.apply(state.tr.insertText('!', 6)); // untagged, e.g. IME / programmatic

    expect(textOf(state.doc)).toBe('Hello!');
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', text: '!', authorId: 'A' });
    expect(textOf(toRejected(state.doc))).toBe('Hello');
  });

  it('restores a plain deletion as deletion-marked text', () => {
    let state = stateWith('Hello');
    state = state.apply(state.tr.delete(2, 4)); // would remove 'el' untracked

    expect(textOf(state.doc)).toBe('Hello'); // text kept, struck out
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'deletion', text: 'el' });
    expect(textOf(toClean(state.doc))).toBe('Hlo');
  });

  it('rewrites a replacement into deletion + insertion (Word-style)', () => {
    let state = stateWith('abc');
    state = state.apply(state.tr.insertText('XY', 2, 3)); // replace 'b' with 'XY'

    expect(textOf(state.doc)).toBe('abXYc'); // struck 'b' precedes inserted 'XY'
    const types = listSuggestions(state.doc).map((s) => ({ type: s.type, text: s.text }));
    expect(types).toContainEqual({ type: 'deletion', text: 'b' });
    expect(types).toContainEqual({ type: 'insertion', text: 'XY' });
    expect(textOf(toClean(state.doc))).toBe('aXYc');
    expect(textOf(toRejected(state.doc))).toBe('abc');
  });

  it("really removes the author's own un-accepted insertion (IME composition update)", () => {
    let state = stateWith('Hi');
    state = run(state, suggestInsertTextAt(3, 3, 'compose')); // own tracked insertion
    expect(textOf(state.doc)).toBe('Hicompose');

    // Untagged replacement of the own composed text — like an IME update.
    state = state.apply(state.tr.insertText('done', 3, 10));

    expect(textOf(state.doc)).toBe('Hidone'); // old composition dropped for real
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', text: 'done' });
    expect(textOf(toClean(state.doc))).toBe('Hidone');
    expect(textOf(toRejected(state.doc))).toBe('Hi');
  });
});

describe('rewrite plugin — exemptions', () => {
  it('leaves suggestion-tagged transactions alone', () => {
    let state = stateWith('Hello');
    state = state.apply(tagSuggestionTx(state.tr.delete(2, 4)));

    expect(textOf(state.doc)).toBe('Hlo'); // applied as-is
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('leaves history (undo/redo) transactions alone', () => {
    let state = stateWith('Hello');
    state = state.apply(state.tr.delete(2, 4).setMeta('history$', {}));

    expect(textOf(state.doc)).toBe('Hlo');
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('leaves addToHistory:false (external sync) transactions alone', () => {
    let state = stateWith('Hello');
    state = state.apply(state.tr.delete(2, 4).setMeta('addToHistory', false));

    expect(textOf(state.doc)).toBe('Hlo');
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('is inert when suggesting is off', () => {
    let state = stateWith('Hello', 'A', false);
    state = state.apply(state.tr.delete(2, 4));

    expect(textOf(state.doc)).toBe('Hlo');
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });
});

describe('rewrite plugin — structural pass-through', () => {
  it('lets an Enter split through untracked (documented mark-model limit)', () => {
    let state = stateWith('Hello');
    state = state.apply(state.tr.split(3));

    expect(state.doc.childCount).toBe(2); // split applied
    expect(textOf(state.doc)).toBe('Hello');
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('skips restoring a multi-block deletion but keeps the document valid', () => {
    const doc = schema.node('doc', null, [para(schema.text('one')), para(schema.text('two'))]);
    let state = EditorState.create({
      schema,
      doc,
      plugins: createSuggestingPlugins({ suggesting: true, authorId: 'A' }),
    });
    // Delete across the paragraph boundary ('ne' + boundary + 'tw').
    state = state.apply(state.tr.delete(3, 8));

    expect(listSuggestions(state.doc)).toHaveLength(0); // not restorable inline
    expect(textOf(state.doc)).toBe('ono'); // 'on' + 'o' — paragraphs merged untracked
  });
});
