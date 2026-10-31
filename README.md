# track-changes

Word-style **tracked changes (suggesting mode)** for ProseMirror / Tiptap
editors, split into MIT packages:

| Package | What it is |
|---|---|
| [`track-changes-core`](packages/track-changes-core) | Headless engine: insertion/deletion/format-change suggestions as **document data** (marks + node attributes), accept/reject, clean projections, rewrite plugin, lossless HTML codec — plus the framework-agnostic editor kit and CKEditor-style feature plugins (formatting, link, image upload + external-image localization, tables) every adapter shares. |
| [`track-changes-vue`](packages/track-changes-vue) | Vue 3 `<TrackChangesEditor>` on `@tiptap/vue-3`. |
| [`track-changes-react`](packages/track-changes-react) | React 18/19 `<TrackChangesEditor>` on `@tiptap/react`. |
| [`track-changes-vanilla`](packages/track-changes-vanilla) | No framework: `createTrackChangesEditor(element, options)`. |
| [`track-changes-styles`](packages/track-changes-styles) | Screen + print CSS for `<ins>`/`<del>`/format-highlight rendering, toolbar, and counter. Optional. |

The three adapters render identical markup and share one implementation of
modes, features, hydration, and review, so they behave the same and the same
stylesheet applies to all of them.

Built only on the MIT open-source tier of Tiptap/ProseMirror — no commercial
license required.

## Design keystone

Every suggestion is **document data** — `<ins>`/`<del>` tags and
`data-suggestion-*` attributes carrying `{ id, authorId, ts }` — never editor
plugin state. So suggestions:

- persist losslessly in **plain HTML strings** (store rich text as a `TEXT`
  column, no JSON blobs required)
- render correctly in print / PDF without the editor
- survive copy/paste and round-trip through any HTML pipeline
- are collaboration-ready (the data travels with the document)

## Quick start

### Vue

```bash
npm i track-changes-vue track-changes-core track-changes-styles \
      @tiptap/core @tiptap/starter-kit @tiptap/vue-3 vue
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TrackChangesEditor, createFormattingFeature } from 'track-changes-vue'
import 'track-changes-styles/track-changes.css'

const html = ref('<p>Hello</p>')
</script>

<template>
  <TrackChangesEditor
    v-model="html"
    format="html"
    mode="suggesting"
    author-id="reviewer-1"
    :features="[createFormattingFeature()]"
  />
</template>
```

### React

```bash
npm i track-changes-react track-changes-core track-changes-styles \
      @tiptap/core @tiptap/starter-kit @tiptap/react react react-dom
```

```tsx
import { useState } from 'react'
import { TrackChangesEditor, createFormattingFeature } from 'track-changes-react'
import 'track-changes-styles/track-changes.css'

const features = [createFormattingFeature()]

export function Field() {
  const [html, setHtml] = useState<string>('<p>Hello</p>')
  return (
    <TrackChangesEditor
      value={html}
      onChange={(v) => setHtml(v as string)}
      format="html"
      mode="suggesting"
      authorId="reviewer-1"
      features={features}
    />
  )
}
```

### Vanilla JS

```bash
npm i track-changes-vanilla track-changes-core track-changes-styles \
      @tiptap/core @tiptap/pm @tiptap/starter-kit
```

```ts
import { createTrackChangesEditor, createFormattingFeature } from 'track-changes-vanilla'
import 'track-changes-styles/track-changes.css'

const editor = createTrackChangesEditor(document.querySelector('#field')!, {
  content: '<p>Hello</p>',
  format: 'html',
  mode: 'suggesting',
  authorId: 'reviewer-1',
  features: [createFormattingFeature()],
  onChange: (html) => save(html),
})
editor.acceptAll()
```

See each package's README for the full API, the host integration contract
(uploads, external-image ingestion — **no environment variables in these
packages**, all env config belongs to the consuming backend), and
`docs/track-changes-architecture.md` for the architecture deep-dive
(`docs/track-changes-rfc.md` for the original design rationale; both were
written inside the host application this code was extracted from, so app
references in them point at that project).

## Development

```bash
npm install        # workspace install
npm run build      # builds core, then the vue/react/vanilla adapters
npm run test       # core suite (vitest golden files) + react/vanilla adapter tests
npm run lint       # tsc --noEmit across packages
```

Versioning is independent semver per package — see each `CHANGELOG.md`.

## Provenance

Extracted (with full history) from the TDG Reports platform monorepo, where
these packages power tracked revisions on report resubmissions.

## License

MIT — see [LICENSE](LICENSE).
