# track-changes-vue

Vue 3 adapter for [`track-changes-core`](../track-changes-core):
a `<TrackChangesEditor>` component built on `@tiptap/vue-3` with
CKEditor-style **feature plugins** (formatting, image upload, tables) and
Word-style **tracked changes** (suggesting mode).

Apache 2.0 licensed. Every Tiptap dependency used here is from the MIT open-source
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
      @tiptap/core@^2 @tiptap/pm@^2 @tiptap/starter-kit@^2 @tiptap/vue-3@^2 vue
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
- `createImageUploadFeature({ labels?, accept?, ingestUrl?, localImageOrigins?, isLocalImageSrc?, onImagePaste?, pasteImageLinks?, uploadPastedFiles? })`
  — Insert/Remove image buttons (via `uploadHandler`), and every pasted or
  dropped image is copied into your storage: see below.
- `createTableFeature({ labels?, rows?, cols?, withHeaderRow? })` — Insert
  table / Add row / Delete row / Add column / Delete column. New tables get a
  `<th>` header row by default. Row ops are tracked per row; column ops are
  tracked as **one grouped suggestion** across all rows (shared suggestion
  id), so accepting/rejecting a column is a single decision.

All labels are overridable for i18n. Custom features implement the
`EditorFeature` interface (`extensions()`, `toolbarItems(ctx)`,
`starterKitOptions()`).

## Pasted and dropped images: always a copy in your storage

A document must never depend on someone else's file: if a pasted image
still pointed at the original cloud file, the owner deleting, moving, or
re-permissioning that file would break the image in your document (and the
content could change after review). So the image feature makes sure every
image ends up **as a copy in your own storage** (bucket, CDN, attachments
API):

| What the user pastes / drops | What happens |
|---|---|
| Image file (screenshot, copied file, drag-and-drop) | Uploaded via the editor's `uploadHandler` |
| Bare image / cloud-share link | Copied via `ingestUrl` (see [Pasting a cloud link](#pasting-a-cloud-link)) |
| Image inside copied web/doc content (`<img src="https://…">`) | Copied via `ingestUrl`; `src` swapped to your copy |
| External image with no `ingestUrl` configured | Stripped — never kept as a hotlink |

The `<img>` case is enforced by a reconciler that scans the doc on load and
on every update, so it also catches programmatic inserts. Read-only views
are never mutated, so legacy stored content still renders.
`onImagePaste({ status, url, source })` reports every outcome
(`ingested` / `uploaded` / `rejected` / `stripped`; `source` is `image`,
`link`, or `file`) so the host can show a notice.

### Storage on an `https://` origin (S3/GCS bucket, CDN)

The editor decides what is "yours" by URL. Relative paths and `data:` URLs
always are; **absolute `http(s)` URLs are not, unless you say so** — list
your bucket/CDN origins, or every image you store would look external and
be copied again:

```ts
createImageUploadFeature({
  ingestUrl: (url) => api.ingestImage(url), // server downloads the bytes into the bucket
  localImageOrigins: ['https://my-bucket.s3.ap-east-1.amazonaws.com', 'https://cdn.example.com'],
  // or: isLocalImageSrc: (src) => src.startsWith('https://storage.googleapis.com/my-bucket/'),
})
```

`uploadHandler` / `ingestUrl` must resolve with a src that passes this
check; a result that doesn't is treated as a failed import (the editor
won't loop copying it).

### Pasting a cloud link

With `ingestUrl` set, pasting a **bare link** to an image or a cloud-storage
share (`https://…/photo.png`, Google Drive, OneDrive/SharePoint, Dropbox,
iCloud, Imgur) inserts the image instead of the link text:

1. An "Importing image…" placeholder (`.tc-img-pending`) marks the paste
   point; the user can keep typing.
2. The URL goes to `ingestUrl`. On success the image is inserted at the
   placeholder — a tracked insertion while suggesting.
3. On failure the URL is pasted as plain text (what a normal paste would
   have done).

`onImagePaste` fires with `source: 'link'`. Which links are tried is decided
by `isLikelyImageLink(url)` (exported); pass `pasteImageLinks: (url) => …` to
use your own rule, or `false` to always paste links as text. A pasted link
that is already on one of your `localImageOrigins` is inserted directly.

The backend behind `ingestUrl` must **download the bytes and store its own
copy** — storing or proxying the original URL would bring back exactly the
broken-image problem this feature exists to prevent.

Share links usually point at a **viewer page**, not the file, so the backend
endpoint behind `ingestUrl` should map them to direct downloads (e.g. Google
Drive `…/file/d/<id>/view` → `https://drive.google.com/uc?export=download&id=<id>`,
Dropbox `?dl=0` → `?dl=1`, OneDrive `…?download=1`), then reject anything
whose response is not `image/*`. Private links fail cleanly (text fallback)
unless the server has access.

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
