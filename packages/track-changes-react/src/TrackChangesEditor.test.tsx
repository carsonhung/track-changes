import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode, act, createRef, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { Editor } from '@tiptap/core';
import { createFormattingFeature } from 'track-changes-core';
import { TrackChangesEditor, type TrackChangesEditorRef } from './TrackChangesEditor';
import { useTrackChangesReview, type UseTrackChangesReview } from './useTrackChangesReview';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

function render(ui: ReactNode) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<StrictMode>{ui}</StrictMode>));
}

function typeAtEnd(editor: Editor, text: string) {
  const { view } = editor;
  const end = view.state.doc.content.size - 1;
  const insert = () => view.state.tr.insertText(text, end);
  act(() => {
    const handled = view.someProp('handleTextInput', (f) => f(view, end, end, text, insert));
    if (!handled) view.dispatch(insert());
  });
}

describe('<TrackChangesEditor> (React)', () => {
  it('mounts under StrictMode with the shared markup and a live ref', () => {
    const ref = createRef<TrackChangesEditorRef>();
    render(
      <TrackChangesEditor ref={ref} value="<p>Hello</p>" features={[createFormattingFeature()]} />,
    );
    expect(container.querySelectorAll('.tc-toolbar-btn').length).toBe(7);
    expect(container.querySelector('.ProseMirror')!.textContent).toBe('Hello');
    expect(ref.current!.editor!.isDestroyed).toBe(false);
  });

  it('tracks typing, reports onChange, and drives the review hook', () => {
    const ref = createRef<TrackChangesEditorRef>();
    const changes: unknown[] = [];
    let review!: UseTrackChangesReview;

    function Host() {
      const [editor, setEditor] = useState<Editor | null>(null);
      review = useTrackChangesReview(editor);
      return (
        <TrackChangesEditor
          ref={ref}
          value="<p>Hello</p>"
          authorId="u1"
          format="html"
          onChange={(v) => changes.push(v)}
          onReady={setEditor}
        />
      );
    }
    render(<Host />);

    typeAtEnd(ref.current!.editor!, ' world');
    expect(review.suggestions).toHaveLength(1);
    expect(review.suggestions[0]).toMatchObject({ type: 'insertion', authorId: 'u1' });
    expect(typeof changes.at(-1)).toBe('string');

    act(() => review.acceptAll());
    expect(review.hasSuggestions).toBe(false);
    expect(ref.current!.getCleanHtml()).toBe('<p>Hello world</p>');
  });

  it('follows mode changes and hydrates a still-empty editor once', () => {
    const ref = createRef<TrackChangesEditorRef>();
    const draw = (value: string | null, mode: 'editing' | 'viewing') =>
      act(() =>
        root!.render(
          <StrictMode>
            <TrackChangesEditor ref={ref} value={value} mode={mode} />
          </StrictMode>,
        ),
      );
    render(<TrackChangesEditor ref={ref} value={null} mode="editing" />);

    draw('<p>Loaded</p>', 'editing');
    expect(ref.current!.getHTML()).toBe('<p>Loaded</p>');

    draw('<p>Ignored</p>', 'viewing');
    expect(ref.current!.getHTML()).toBe('<p>Loaded</p>');
    expect(ref.current!.editor!.isEditable).toBe(false);
  });
});
