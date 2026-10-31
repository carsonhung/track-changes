import { describe, it, expect } from 'vitest';
import { EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createExtendedSuggestionSchema } from './schema';
import { createSuggestingPlugins } from './plugin';
import { tagSuggestionTx } from './rewrite';
import { listSuggestions, toClean, toRejected, hasSuggestions, acceptOn, rejectOn } from './clean';

// Format-change suggestions (P2f) are produced by the rewrite plugin from
// plain AddMarkStep / RemoveMarkStep transactions — the exact steps Tiptap's
// toggleBold (toolbar or Ctrl+B) dispatches. Exercised via EditorState.apply.

const schema = createExtendedSuggestionSchema();
const bold = schema.marks.bold;

function para(...inline: PMNode[]) {
  return schema.node('paragraph', null, inline);
}

function stateWith(doc: PMNode, authorId = 'A', suggesting = true) {
  return EditorState.create({
    schema,
    doc,
    plugins: createSuggestingPlugins({ suggesting, authorId }),
  });
}

function plainDoc(text: string) {
  return schema.node('doc', null, [para(schema.text(text))]);
}

function textOf(node: PMNode): string {
  return node.textBetween(0, node.content.size, '');
}

/** [from, to) ranges of bold text in the doc. */
function boldRanges(doc: PMNode): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  doc.descendants((node, pos) => {
    if (node.isText && bold.isInSet(node.marks)) out.push([pos, pos + node.nodeSize]);
    return undefined;
  });
  return out;
}

describe('format-change tracking — add', () => {
  it('rewrites a plain addMark into a tracked format add', () => {
    // 'Hello' — bold 'ell' (positions 2..5)
    let state = stateWith(plainDoc('Hello'));
    state = state.apply(state.tr.addMark(2, 5, bold.create()));

    // Formatting applied for real…
    expect(boldRanges(state.doc)).toEqual([[2, 5]]);
    // …and recorded as a suggestion.
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: 'format',
      formatAction: 'add',
      formatMark: 'bold',
      text: 'ell',
      authorId: 'A',
    });
    expect(hasSuggestions(state.doc)).toBe(true);

    // Accept keeps bold (and drops the format_change); reject removes bold.
    const accepted = toClean(state.doc);
    expect(boldRanges(accepted)).toEqual([[2, 5]]);
    expect(hasSuggestions(accepted)).toBe(false);
    const rejected = toRejected(state.doc);
    expect(boldRanges(rejected)).toEqual([]);
    expect(textOf(rejected)).toBe('Hello');
  });

  it('only records segments that actually changed (partial overlap)', () => {
    // 'abcde' with 'bc' already bold; user bolds 'bcd' → only 'd' is a change.
    const doc = schema.node('doc', null, [
      para(schema.text('a'), schema.text('bc', [bold.create()]), schema.text('de')),
    ]);
    let state = stateWith(doc);
    state = state.apply(state.tr.addMark(2, 5, bold.create()));

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'format', formatAction: 'add', text: 'd' });

    // Reject restores exactly the prior formatting ('bc' stays bold).
    expect(boldRanges(toRejected(state.doc))).toEqual([[2, 4]]);
  });
});

describe('format-change tracking — remove', () => {
  it('rewrites a plain removeMark into a tracked format remove', () => {
    const doc = schema.node('doc', null, [para(schema.text('Hello', [bold.create()]))]);
    let state = stateWith(doc);
    state = state.apply(state.tr.removeMark(1, 6, bold));

    expect(boldRanges(state.doc)).toEqual([]); // removed for real
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'format', formatAction: 'remove', formatMark: 'bold', text: 'Hello' });

    expect(boldRanges(toClean(state.doc))).toEqual([]); // accept: stays removed
    expect(boldRanges(toRejected(state.doc))).toEqual([[1, 6]]); // reject: re-applied
  });
});

describe('format-change tracking — toggle back cancels', () => {
  it('removing a just-suggested bold cancels the suggestion instead of stacking', () => {
    let state = stateWith(plainDoc('Hello'));
    state = state.apply(state.tr.addMark(2, 5, bold.create()));
    expect(listSuggestions(state.doc)).toHaveLength(1);

    state = state.apply(state.tr.removeMark(2, 5, bold));
    expect(listSuggestions(state.doc)).toHaveLength(0);
    expect(boldRanges(state.doc)).toEqual([]);
    expect(hasSuggestions(state.doc)).toBe(false);
  });
});

describe('format-change interactions', () => {
  it('does not track formatting inside a pending insertion', () => {
    let state = stateWith(plainDoc('Hi'));
    state = state.apply(state.tr.insertText('new', 3)); // tracked insertion
    expect(listSuggestions(state.doc)).toHaveLength(1);

    state = state.apply(state.tr.addMark(3, 6, bold.create())); // bold the new text
    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1); // still just the insertion
    expect(list[0].type).toBe('insertion');
    expect(boldRanges(state.doc)).toEqual([[3, 6]]);

    // Rejecting the insertion removes the bold text wholesale.
    expect(textOf(toRejected(state.doc))).toBe('Hi');
  });

  it('per-id accept / reject resolves only that toggle', () => {
    let state = stateWith(plainDoc('Hello'));
    state = state.apply(state.tr.addMark(1, 3, bold.create())); // 'He'
    state = state.apply(state.tr.addMark(4, 6, bold.create())); // 'lo'
    const [first, second] = listSuggestions(state.doc);
    expect(first.type).toBe('format');
    expect(second.type).toBe('format');

    // Accept the first, reject the second.
    let tr = state.tr;
    acceptOn(tr, first.id);
    state = state.apply(tagSuggestionTx(tr));
    tr = state.tr;
    rejectOn(tr, second.id);
    state = state.apply(tagSuggestionTx(tr));

    expect(boldRanges(state.doc)).toEqual([[1, 3]]);
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('ignores mark steps when not suggesting', () => {
    let state = stateWith(plainDoc('Hello'), 'A', false);
    state = state.apply(state.tr.addMark(1, 4, bold.create()));
    expect(boldRanges(state.doc)).toEqual([[1, 4]]);
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });

  it('ignores tagged (already-encoded) mark transactions', () => {
    let state = stateWith(plainDoc('Hello'));
    state = state.apply(tagSuggestionTx(state.tr.addMark(1, 4, bold.create())));
    expect(listSuggestions(state.doc)).toHaveLength(0);
  });
});

describe('format-change HTML round-trip', () => {
  it('serializes to a span[data-suggestion-format] and parses back', async () => {
    // happy-dom is only needed for this test; html.test.ts covers the codec in
    // depth. Here we assert the format_change mark participates.
    const { Window } = await import('happy-dom');
    const dom = new Window().document as unknown as Document;
    const { docToHtml, htmlToDoc } = await import('./html');

    let state = stateWith(plainDoc('Hello'));
    state = state.apply(state.tr.addMark(2, 5, bold.create()));

    const html = docToHtml(state.doc, { document: dom });
    expect(html).toContain('data-suggestion-format="add:bold"');

    const restored = htmlToDoc(html, schema, { document: dom });
    const list = listSuggestions(restored);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'format', formatAction: 'add', formatMark: 'bold', text: 'ell' });
    expect(boldRanges(toRejected(restored))).toEqual([]);
  });
});
