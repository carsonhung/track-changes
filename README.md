# track-changes

Word-style **tracked changes (suggesting mode)** for ProseMirror / Tiptap
editors, split into three MIT packages:

| Package | What it is |
|---|---|
| [`@carsonhung/track-changes-core`](packages/track-changes-core) | Headless engine: insertion/deletion/format-change suggestions as **document data** (marks + node attributes), accept/reject, clean projections, rewrite plugin, lossless HTML codec. Framework-free. |
| [`@carsonhung/track-changes-vue`](packages/track-changes-vue) | Vue 3 `<TrackChangesEditor>` on `@tiptap/vue-3`, with CKEditor-style feature plugins: formatting (schema-gated), image upload + external-image localization, tables. |
| [`@carsonhung/track-changes-styles`](packages/track-changes-styles) | Screen + print CSS for `<ins>`/`<del>`/format-highlight rendering. Optional. |

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

```bash
npm i @carsonhung/track-changes-vue @carsonhung/track-changes-core \
      @tiptap/core @tiptap/starter-kit @tiptap/vue-3 vue
```

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { TrackChangesEditor, createFormattingFeature } from '@carsonhung/track-changes-vue'
import '@carsonhung/track-changes-styles/track-changes.css'

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
npm run build      # builds core, then vue (vue depends on core)
npm run test       # core test suite (vitest golden files)
npm run lint       # tsc --noEmit across packages
```

Versioning is independent semver per package — see each `CHANGELOG.md`.

## Provenance

Extracted (with full history) from the TDG Reports platform monorepo, where
these packages power tracked revisions on report resubmissions.

## License

MIT — see [LICENSE](LICENSE).
