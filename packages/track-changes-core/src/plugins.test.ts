import { describe, it, expect, vi } from 'vitest';
import { EditorState, TextSelection, type Command, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import { createBasicSuggestionSchema } from './schema';
import {
  createSuggestingPlugins,
  createClipboardSuggestingPlugin,
  sliceText,
} from './plugin';
import { suggestDeleteBackward } from './commands';
import { trackChangesKey } from './state';
import { listSuggestions, toClean } from './clean';
import { DELETION } from './marks';

const schema = createBasicSuggestionSchema();

function para(...inline: PMNode[]) {
  return schema.node('paragraph', null, inline);
}

function stateWith(text: string, authorId = 'A') {
  return EditorState.create({
    schema,
    doc: schema.node('doc', null, [para(...(text ? [schema.text(text)] : []))]),
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

function select(state: EditorState, from: number, to = from): EditorState {
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, from, to)));
}

function textOf(node: PMNode): string {
  return node.textBetween(0, node.content.size, '');
}

/** Minimal stateful stand-in for an EditorView (the plugins only use state/dispatch). */
function fakeView(initial: EditorState): EditorView & { state: EditorState } {
  const v = {
    state: initial,
    dispatch(tr: Transaction) {
      v.state = v.state.apply(tr);
    },
  };
  return v as unknown as EditorView & { state: EditorState };
}

describe('deletion re-marking guard', () => {
  it('re-deleting over an existing suggested deletion keeps its id and author', () => {
    let state = stateWith('abc', 'A');
    state = select(state, 1, 4);
    state = run(state, suggestDeleteBackward);
    const [first] = listSuggestions(state.doc);
    expect(first.type).toBe('deletion');

    // Author B sweeps the same (still visible) range.
    state = state.apply(state.tr.setMeta(trackChangesKey, { authorId: 'B' }));
    state = select(state, 1, 4);
    state = run(state, suggestDeleteBackward);

    const after = listSuggestions(state.doc);
    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(first.id);
    expect(after[0].authorId).toBe('A');
  });
});

describe('consecutive deletion merging', () => {
  it('successive Backspace presses form a single suggestion', () => {
    let state = stateWith('abc');
    state = select(state, 4); // caret after 'c'
    state = run(state, suggestDeleteBackward); // marks 'c'
    state = select(state, 3); // caret after 'b' (before deleted 'c')
    state = run(state, suggestDeleteBackward); // marks 'b' — should merge

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(1);
    expect(list[0].text).toBe('bc');
    expect(textOf(toClean(state.doc))).toBe('a');
  });

  it('a different author backspacing adjacent text starts a new suggestion', () => {
    let state = stateWith('abc', 'A');
    state = select(state, 4);
    state = run(state, suggestDeleteBackward); // A marks 'c'

    state = state.apply(state.tr.setMeta(trackChangesKey, { authorId: 'B' }));
    state = select(state, 3);
    state = run(state, suggestDeleteBackward); // B marks 'b'

    const list = listSuggestions(state.doc);
    expect(list).toHaveLength(2);
    expect(new Set(list.map((s) => s.authorId))).toEqual(new Set(['A', 'B']));
  });
});

describe('clipboard plugin — paste', () => {
  const plugin = createClipboardSuggestingPlugin();
  const handlePaste = plugin.props.handlePaste! as (
    view: EditorView,
    event: ClipboardEvent,
    slice: Slice,
  ) => boolean;

  function sliceOf(...inline: PMNode[]): Slice {
    const d = schema.node('doc', null, [para(...inline)]);
    return d.slice(1, d.content.size - 1);
  }

  it('pasted text becomes a tracked insertion', () => {
    const view = fakeView(select(stateWith('Hi '), 4));
    const handled = handlePaste(view, {} as ClipboardEvent, sliceOf(schema.text('there')));
    expect(handled).toBe(true);

    const list = listSuggestions(view.state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', text: 'there' });
    expect(textOf(toClean(view.state.doc))).toBe('Hi there');
  });

  it('blocks a slice with no text instead of applying it untracked', () => {
    const view = fakeView(select(stateWith('Hi '), 4));
    const before = view.state.doc;
    const handled = handlePaste(view, {} as ClipboardEvent, sliceOf());
    expect(handled).toBe(true); // swallowed
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('is inert when suggesting is off', () => {
    const state = EditorState.create({
      schema,
      doc: schema.node('doc', null, [para(schema.text('x'))]),
      plugins: createSuggestingPlugins({ suggesting: false }),
    });
    const handled = handlePaste(fakeView(state), {} as ClipboardEvent, sliceOf(schema.text('y')));
    expect(handled).toBe(false);
  });
});

describe('clipboard plugin — cut', () => {
  const plugin = createClipboardSuggestingPlugin();
  const cut = plugin.props.handleDOMEvents!.cut! as (
    view: EditorView,
    event: ClipboardEvent,
  ) => boolean;

  function fakeCutEvent() {
    return {
      clipboardData: { setData: vi.fn() },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent & {
      clipboardData: { setData: ReturnType<typeof vi.fn> };
      preventDefault: ReturnType<typeof vi.fn>;
    };
  }

  it('writes the clipboard and records the selection as a tracked deletion', () => {
    const view = fakeView(select(stateWith('abc'), 2, 4)); // selects 'bc'
    const event = fakeCutEvent();
    expect(cut(view, event)).toBe(true);

    expect(event.clipboardData.setData).toHaveBeenCalledWith('text/plain', 'bc');
    expect(event.preventDefault).toHaveBeenCalled();
    // Text stays, deletion-marked.
    expect(textOf(view.state.doc)).toBe('abc');
    const list = listSuggestions(view.state.doc);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: DELETION, text: 'bc' });
    expect(textOf(toClean(view.state.doc))).toBe('a');
  });

  it('ignores an empty selection', () => {
    const view = fakeView(select(stateWith('abc'), 2));
    expect(cut(view, fakeCutEvent())).toBe(false);
  });
});

describe('sliceText', () => {
  it('joins block boundaries with newlines', () => {
    const d = schema.node('doc', null, [para(schema.text('one')), para(schema.text('two'))]);
    expect(sliceText(d.slice(1, d.content.size - 1))).toBe('one\ntwo');
  });
});
