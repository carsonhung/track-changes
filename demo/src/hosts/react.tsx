import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { TrackChangesEditor } from 'track-changes-react';
import type { EditorMode } from 'track-changes-core';
import type { EditorHost, HostOptions } from './types';

export function mount(el: HTMLElement, o: HostOptions): EditorHost {
  const root = createRoot(el);
  let mode: EditorMode = o.mode;
  let authorId = o.authorId;

  const render = () =>
    root.render(
      <StrictMode>
        <TrackChangesEditor
          value={o.content}
          onChange={o.onChange}
          format="html"
          mode={mode}
          authorId={authorId}
          features={o.features}
          uploadHandler={o.uploadHandler}
          maxWords={o.maxWords}
          onReady={o.onReady}
        />
      </StrictMode>,
    );
  render();

  return {
    setMode: (m) => {
      mode = m;
      render();
    },
    setAuthor: (a) => {
      authorId = a;
      render();
    },
    destroy: () => root.unmount(),
  };
}
