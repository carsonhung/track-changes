import { describe, it, expect, afterEach } from 'vitest';
import { createFormattingFeature, type SuggestionSummary } from 'track-changes-core';
import { createTrackChangesEditor, type TrackChangesEditorHandle } from './createTrackChangesEditor';

let handle: TrackChangesEditorHandle | null = null;

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = '';
});

function mount(options: Parameters<typeof createTrackChangesEditor>[1] = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  handle = createTrackChangesEditor(target, options);
  return { target, handle };
}

/** Type `text` at the end of the doc through the view, like real user input. */
function typeAtEnd(h: TrackChangesEditorHandle, text: string) {
  const { view } = h.editor;
  const end = view.state.doc.content.size - 1;
  const insert = () => view.state.tr.insertText(text, end);
  const handled = view.someProp('handleTextInput', (f) => f(view, end, end, text, insert));
  if (!handled) view.dispatch(insert());
}

describe('createTrackChangesEditor', () => {
  it('renders the shared .tc-editor markup into the target', () => {
    const { target } = mount({ content: '<p>Hello</p>', features: [createFormattingFeature()] });
    const root = target.querySelector('.tc-editor')!;
    expect(root).not.toBeNull();
    expect(root.querySelector('.tc-toolbar')).not.toBeNull();
    expect(root.querySelectorAll('.tc-toolbar-btn').length).toBe(7);
    expect(root.querySelector('.ProseMirror')!.textContent).toBe('Hello');
  });

  it('records typing as a suggestion and accepts it', () => {
    const seen: SuggestionSummary[][] = [];
    const changes: unknown[] = [];
    const { handle: h } = mount({
      content: '<p>Hello</p>',
      authorId: 'u1',
      onChange: (v) => changes.push(v),
      onSuggestionsChange: (s) => seen.push(s),
    });
    typeAtEnd(h, ' world');

    const list = h.listSuggestions();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ type: 'insertion', authorId: 'u1', text: ' world' });
    expect(seen.at(-1)).toHaveLength(1);
    expect(changes.length).toBeGreaterThan(0);

    h.accept(list[0].id);
    expect(h.listSuggestions()).toHaveLength(0);
    expect(h.getCleanHtml()).toBe('<p>Hello world</p>');
  });

  it('applies edits directly in editing mode and hides the toolbar when viewing', () => {
    const { target, handle: h } = mount({
      content: '<p>A</p>',
      mode: 'editing',
      features: [createFormattingFeature()],
    });
    typeAtEnd(h, 'B');
    expect(h.listSuggestions()).toHaveLength(0);

    h.setMode('viewing');
    expect(h.editor.isEditable).toBe(false);
    expect((target.querySelector('.tc-toolbar') as HTMLElement).hidden).toBe(true);

    h.setMode('suggesting');
    expect(h.editor.isEditable).toBe(true);
    typeAtEnd(h, 'C');
    expect(h.listSuggestions()).toHaveLength(1);
  });

  it('counts the clean projection and flags the over-limit state', () => {
    const { target, handle: h } = mount({ content: '<p>abc</p>', maxCharacters: 4 });
    const counter = target.querySelector('.tc-charcount')!;
    expect(counter.textContent).toBe('3 / 4 · 1w');
    typeAtEnd(h, 'de');
    expect(counter.classList.contains('tc-charcount--over')).toBe(true);
  });

  it('reloads stored suggestions even when formatting marks claim the same tags', () => {
    const stored =
      '<p>The <del data-suggestion="d1" data-author="bob" data-ts="1">old</del>' +
      '<ins data-suggestion="i1" data-author="bob" data-ts="1">new</ins> ' +
      '<span data-suggestion="f1" data-suggestion-format="add:bold" data-author="bob" data-ts="1">' +
      '<strong>plan</strong></span></p>';
    const { handle: h } = mount({ content: stored, features: [createFormattingFeature()] });
    expect(h.listSuggestions().map((s) => [s.id, s.type])).toEqual([
      ['d1', 'deletion'],
      ['i1', 'insertion'],
      ['f1', 'format'],
    ]);
    expect(h.getHTML()).not.toContain('<s>');

    // Save → reload is stable.
    const saved = h.getHTML()!;
    h.setContent(saved);
    expect(h.getHTML()).toBe(saved);
    expect(h.listSuggestions()).toHaveLength(3);
  });

  it('typing over a multi-paragraph selection keeps the old text as a deletion', () => {
    const { handle: h } = mount({ content: '<p>First para</p><p>Second para</p>', authorId: 'bob' });
    const { view } = h.editor;
    h.editor.commands.selectAll();
    const event = new KeyboardEvent('keypress', { key: 'X', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'charCode', { value: 88 });
    view.dom.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(h.listSuggestions().map((s) => [s.type, s.text])).toEqual([
      ['deletion', 'First paraSecond para'],
      ['insertion', 'X'],
    ]);
    h.rejectAll();
    expect(h.editor.getText({ blockSeparator: '|' })).toBe('First para|Second para');
  });

  it('returns the document in the requested format and removes its DOM on destroy', () => {
    const { target, handle: h } = mount({ content: '<p>x</p>', format: 'html' });
    expect(h.getValue()).toBe('<p>x</p>');
    h.destroy();
    handle = null;
    expect(target.querySelector('.tc-editor')).toBeNull();
  });
});
