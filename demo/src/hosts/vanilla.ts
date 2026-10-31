import { createTrackChangesEditor } from 'track-changes-vanilla';
import type { EditorHost, HostOptions } from './types';

export function mount(el: HTMLElement, o: HostOptions): EditorHost {
  const handle = createTrackChangesEditor(el, {
    content: o.content,
    format: 'html',
    mode: o.mode,
    authorId: o.authorId,
    features: o.features,
    uploadHandler: o.uploadHandler,
    maxWords: o.maxWords,
    onChange: o.onChange,
  });
  o.onReady(handle.editor);
  return {
    setMode: handle.setMode,
    setAuthor: handle.setAuthor,
    destroy: handle.destroy,
  };
}
