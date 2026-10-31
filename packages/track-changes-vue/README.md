# track-changes-vue

Vue 3 adapter for [`track-changes-core`](../track-changes-core):
a `<TrackChangesEditor>` component built on `@tiptap/vue-3` with
CKEditor-style **feature plugins** (formatting, image upload, tables) and
Word-style **tracked changes** (suggesting mode).

MIT licensed. Every Tiptap dependency used here is from the MIT open-source
tier — no Tiptap Pro / commercial license is required.

```
+--------------------------------------------------------------+
| host app (forms, persistence, storage, auth, env config)     |
+--------------------------▲-----------------------------------+
                           │ props + handlers (this contract)
+--------------------------┴-----------------------------------+
| track-changes-vue   <TrackChangesEditor>                     |
|   feature plugins: formatting / imageUpload / table          |
+--------------------------▲-----------------------------------+
                           │
+--------------------------┴-----------------------------------+
| track-changes-core  (headless engine, PM/Tiptap)            |
+--------------------------------------------------------------+
```

## Install

The package ships compiled ESM/CJS + types. Peer dependencies (host-provided
so there is exactly one copy of each):

```bash
npm i track-changes-vue track-changes-core \
      @tiptap/core @tiptap/starter-kit @tiptap/vue-3 vue
```

Optional, for the default `<ins>`/`<del>`/format-highlight rendering:

```ts
import 'track-changes-styles/track-changes.css'
```

> **No environment variables.** This package reads no `.env`, no
> `import.meta.env`, and talks to no backend. Everything environment-specific
> (upload endpoints, storage folders, size limits, allow-lists) belongs to the
> host application and reaches the editor only through the handler props
> documented below. See [Host integration contract](#host-integration-contract).

## Quick start

```vue
<script setup lang="ts">
import { ref } from 'vue'
import {
  TrackChangesEditor,
  createFormattingFeature,
  createImageUploadFeature,
  createTableFeature,
} from 'track-changes-vue'
import 'track-changes-styles/track-changes.css'

const html = ref<string | null>('<p>Initial content</p>')

const features = [
  createFormattingFeature(),
  createImageUploadFeature({
    // host glue — see "Host integration contract"
    ingestUrl: (url) => myBackend.ingestImage(url),
  }),
  createTableFeature(),
]

const upload = async (file: File) => ({ src: await myBackend.upload(file) })
</script>

<template>
  <TrackChangesEditor
    v-model="html"
    format="html"
    mode="suggesting"
    author-id="reviewer-1"
    :features="features"
    :upload-handler="upload"
  />
</template>
```

## `<TrackChangesEditor>` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `modelValue` | `object \| string \| null` | `null` | Input accepts a ProseMirror JSON doc **or** an HTML string, regardless of `format`. One-way after mount (the editor owns its document); re-mount via `:key` to load a different document. |
| `format` | `'json' \| 'html'` | `'json'` | Format emitted via `update:modelValue`. `html` is lossless — suggestions are real `<ins>`/`<del>` tags and `data-suggestion-*` attributes — so the value can be stored as plain text in a DB and printed/PDF-rendered without the editor. |
| `mode` | `'editing' \| 'suggesting' \| 'viewing'` | `'suggesting'` | `suggesting` records every edit as a tracked change; `viewing` is read-only. |
| `authorId` | `string \| null` | `null` | Attributed on new suggestions (`data-author`). |
| `readonly` | `boolean` | `false` | |
| `features` | `EditorFeature[]` | `[]` | Feature plugins composing extensions + toolbar (below). |
| `extensions` | Tiptap `Extensions` | `[]` | Extra raw extensions, for hosts that need more than the built-in features. |
| `uploadHandler` | `EditorUploadHandler \| null` | `null` | Host upload transport: `(file: File) => Promise<{ src, alt? }>`. |
| `maxCharacters` | `number \| null` | `null` | Soft character cap: shows a clean-projection counter footer ("123 / 2,000") with an over-limit state. Input is never hard-blocked (tracked deletions keep text in the doc) — enforce at submit time via the same projection (`countCleanText`). |
| `maxWords` | `number \| null` | `null` | Soft word cap ("45 / 500w"), same semantics as `maxCharacters`; either or both can be set, and the footer highlights whichever cap is exceeded. Word counting is CJK-aware (each Chinese/Japanese character counts as one word, the MS Word 字数 convention; Latin text splits on whitespace; mixed text composes). |
| `showCharacterCount` | `boolean` | `false` | Show the counter footer even without a cap. |

Imperative API via template ref (`TrackChangesEditorApi`): `accept(id)`,
`reject(id)`, `acceptAll()`, `rejectAll()`, `listSuggestions()`,
`setSuggesting(on)`, `insertNode()`, `deleteNode(pos)`, `getClean()`,
`getHTML()`, `getCleanHtml()`, and the raw Tiptap `editor`.

For headless review UIs (sidebars listing pending changes with per-change
accept/reject), use the `useTrackChangesReview(editorRef)` composable.

## Feature plugins

Features are created per editor instance, so disabling a capability is just
*not passing the feature* — and the restriction is real, not cosmetic:

- `createFormattingFeature({ buttons?, labels? })` — bold / italic / strike /
  headings / lists. Without this feature the StarterKit formatting pieces are
  **disabled at the schema level**: no Ctrl+B, no markdown input rules, pasted
  formatting is stripped. `buttons` narrows further (a bold-only field rejects
  headings wholesale). In suggesting mode, toggles are recorded as reviewable
  `format_change` suggestions.
- `createLinkFeature({ labels?, promptUrl? })` — Set link / Remove link on the
  selection. Dependency-free `link` mark rendering `<a href>` with an enforced
  `rel="noopener noreferrer nofollow"`; only `http(s)`/`mailto` hrefs parse, so
  pasted `javascript:`/`data:` links are rejected at the schema level. The
  default URL input is `window.prompt`; pass `promptUrl(current, message)` to
  use your own dialog. In suggesting mode, setting/removing a link is recorded
  as a reviewable `format_change` suggestion.
- `createImageUploadFeature({ labels?, accept?, ingestUrl?, onImagePaste? })`
  — Insert/Remove image buttons (via `uploadHandler`), plus **external-image
  localization**: see below.
- `createTableFeature({ labels?, rows?, cols?, withHeaderRow? })` — Insert
  table / Add row / Delete row / Add column / Delete column. New tables get a
  `<th>` header row by default. Row ops are tracked per row; column ops are
  tracked as **one grouped suggestion** across all rows (shared suggestion
  id), so accepting/rejecting a column is a single decision.

All labels are overridable for i18n. Custom features implement the
`EditorFeature` interface (`extensions()`, `toolbarItems(ctx)`,
`starterKitOptions()`).

## Pasted "cloud images" (external-image localization)

Hotlinked `http(s)` images are a liability in archived documents (auth-gated
cloud URLs expire, remote content can change after review). The image-upload
feature therefore **never leaves an external image in an editable document**.
A reconciler plugin scans the doc on load and on every update (so it also
catches drag-and-drop and programmatic inserts):

| Host wiring | Behaviour on external `src` |
|---|---|
| `ingestUrl` provided | Handler copies the image into host storage; the node's `src` is swapped to the returned local value. On rejection the image is removed. |
| No `ingestUrl` | The image is stripped immediately. |

Either way `onImagePaste({ status: 'ingested' \| 'rejected' \| 'stripped', url })`
fires so the host can show a notice. Read-only views are never mutated, so
legacy stored content still renders.

## Host integration contract

The two handler types are the entire surface between the editor and the
host's infrastructure:

```ts
/** Where do uploaded bytes go? (file picker, drag-drop) */
type EditorUploadHandler = (file: File) => Promise<{ src: string; alt?: string }>

/** How is a pasted external image copied into host storage? */
type EditorUrlIngestHandler = (url: string) => Promise<{ src: string; alt?: string }>
```

Typical implementations:

- **Data URL** (no backend): read the file/blob into a `data:` URL — the
  document stays self-contained.
- **Backend ingestion** (recommended for `ingestUrl`): browsers cannot fetch
  most cloud images (CORS), so POST the URL to a backend endpoint that fetches
  server-side, validates, stores, and returns a local `src`.

### Backend requirements (reference implementation)

This repo's host backend implements the contract as
`POST /api/attachments/:entityType/:entityId/ingest`
(`apps/backend/src/modules/attachments` + `apps/backend/src/lib/urlIngest.ts`),
configured entirely through environment variables — this is where ".env"
lives, **not** in this package:

| Env var (host backend) | Default | Purpose |
|---|---|---|
| `STORAGE_DIR` | `./data/uploads` | Upload folder; ingested images land here like direct uploads |
| `STORAGE_MAX_BYTES` | `10485760` | Per-file size cap (also enforced on ingested bytes) |
| `STORAGE_ALLOWED_MIME` | (list) | MIME allow-list; ingestion additionally requires `image/*` |
| `STORAGE_INGEST_TIMEOUT_MS` | `10000` | Server-side fetch timeout |
| `STORAGE_INGEST_ALLOWED_HOSTS` | (empty) | Optional source-host allow-list (+ subdomains); empty = any public host |

A server that fetches arbitrary URLs is an **SSRF surface**. If you implement
your own endpoint, replicate at least these guards (all unit-tested in
`lib/urlIngest.ts`):

- block private / loopback / link-local / cloud-metadata addresses (IPv4 + IPv6)
- re-resolve DNS and re-check the resolved address (names can point anywhere)
- follow redirects manually and validate **every hop**
- stream the body with a hard byte cap (never trust `Content-Length`)
- require an `image/*` content type; store under an opaque server-generated key

## Versioning

Independent semver per package; see [CHANGELOG.md](./CHANGELOG.md). A runtime
`VERSION` constant is exported for diagnostics.
