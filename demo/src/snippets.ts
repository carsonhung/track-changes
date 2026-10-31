import type { Framework } from './hosts/types';

export interface FrameworkInfo {
  label: string;
  pkg: string;
  file: string;
  code: string;
}

const vanilla = `import {
  createTrackChangesEditor,
  createFormattingFeature,
  createTableFeature,
} from 'track-changes-vanilla'
import 'track-changes-styles/track-changes.css'

const editor = createTrackChangesEditor(document.querySelector('#editor'), {
  content: savedHtml,
  format: 'html',
  mode: 'suggesting',
  authorId: currentUser.id,
  features: [createFormattingFeature(), createTableFeature()],
  uploadHandler: async (file) => ({ src: await uploadToBucket(file) }),
  onChange: (html) => save(html),
  onSuggestionsChange: (suggestions) => renderReviewPanel(suggestions),
})

// Review from anywhere
editor.accept(id)
editor.reject(id)
editor.acceptAll()
editor.getCleanHtml() // the text with every suggestion accepted`;

const vue = `<script setup lang="ts">
import { ref } from 'vue'
import {
  TrackChangesEditor,
  useTrackChangesReview,
  createFormattingFeature,
  createTableFeature,
  type TrackChangesEditorApi,
} from 'track-changes-vue'
import 'track-changes-styles/track-changes.css'

const html = ref(savedHtml)
const editorRef = ref<TrackChangesEditorApi | null>(null)
const { suggestions, accept, reject } = useTrackChangesReview(editorRef)

const features = [createFormattingFeature(), createTableFeature()]
const upload = async (file: File) => ({ src: await uploadToBucket(file) })
</script>

<template>
  <TrackChangesEditor
    ref="editorRef"
    v-model="html"
    format="html"
    mode="suggesting"
    :author-id="currentUser.id"
    :features="features"
    :upload-handler="upload"
  />

  <ul>
    <li v-for="s in suggestions" :key="s.id">
      {{ s.authorId }} {{ s.type }} “{{ s.text }}”
      <button @click="accept(s.id)">Accept</button>
      <button @click="reject(s.id)">Reject</button>
    </li>
  </ul>
</template>`;

const react = `import { useState } from 'react'
import type { Editor } from '@tiptap/core'
import {
  TrackChangesEditor,
  useTrackChangesReview,
  createFormattingFeature,
  createTableFeature,
} from 'track-changes-react'
import 'track-changes-styles/track-changes.css'

const features = [createFormattingFeature(), createTableFeature()]
const upload = async (file: File) => ({ src: await uploadToBucket(file) })

export function ReportField({ savedHtml, user }: Props) {
  const [editor, setEditor] = useState<Editor | null>(null)
  const { suggestions, accept, reject } = useTrackChangesReview(editor)

  return (
    <>
      <TrackChangesEditor
        value={savedHtml}
        onChange={save}
        format="html"
        mode="suggesting"
        authorId={user.id}
        features={features}
        uploadHandler={upload}
        onReady={setEditor}
      />

      <ul>
        {suggestions.map((s) => (
          <li key={s.id}>
            {s.authorId} {s.type} “{s.text}”
            <button onClick={() => accept(s.id)}>Accept</button>
            <button onClick={() => reject(s.id)}>Reject</button>
          </li>
        ))}
      </ul>
    </>
  )
}`;

export const FRAMEWORKS: Record<Framework, FrameworkInfo> = {
  vanilla: { label: 'Vanilla JS', pkg: 'track-changes-vanilla', file: 'editor.ts', code: vanilla },
  vue: { label: 'Vue 3', pkg: 'track-changes-vue', file: 'ReportField.vue', code: vue },
  react: { label: 'React', pkg: 'track-changes-react', file: 'ReportField.tsx', code: react },
};
