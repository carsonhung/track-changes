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

  it('returns the document in the requested format and removes its DOM on destroy', () => {
    const { target, handle: h } = mount({ content: '<p>x</p>', format: 'html' });
    expect(h.getValue()).toBe('<p>x</p>');
    h.destroy();
    handle = null;
    expect(target.querySelector('.tc-editor')).toBeNull();
  });
});
