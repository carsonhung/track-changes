import { createApp, h, ref } from 'vue';
import { TrackChangesEditor } from 'track-changes-vue';
import type { EditorMode } from 'track-changes-core';
import type { EditorHost, HostOptions } from './types';

export function mount(el: HTMLElement, o: HostOptions): EditorHost {
  const mode = ref<EditorMode>(o.mode);
  const authorId = ref(o.authorId);
  const html = ref<string>(o.content);

  const app = createApp({
    render: () =>
      h(TrackChangesEditor, {
        modelValue: html.value,
        'onUpdate:modelValue': (value: unknown) => {
          html.value = value as string;
          o.onChange();
        },
        format: 'html',
        mode: mode.value,
        authorId: authorId.value,
        features: o.features,
        uploadHandler: o.uploadHandler,
        maxWords: o.maxWords,
        onReady: o.onReady,
      }),
  });
  app.mount(el);

  return {
    setMode: (m) => (mode.value = m),
    setAuthor: (a) => (authorId.value = a),
    destroy: () => app.unmount(),
  };
}
