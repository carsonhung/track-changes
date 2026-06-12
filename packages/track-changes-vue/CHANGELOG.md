# @tdg-reports/track-changes-vue

## 0.10.0

- **Table columns + header row.** The table feature gains Add column /
  Delete column toolbar items and a `tableHeader` (`<th>`) cell node; new
  tables are inserted with a header row by default (`withHeaderRow: false`
  to opt out). Column ops are tracked as ONE grouped suggestion across all
  rows (core `suggestInsertNodes` / `suggestDeleteNodes`), so accepting or
  rejecting a column is a single decision; ragged mid-edit tables clamp to
  each row's last cell. Delete column stays disabled while any row has only
  one cell, keeping the table schema-valid. New `featureInsertNodes` /
  `featureDeleteNodes` helpers for custom features.
- **Character/word count footer.** New `maxCharacters` (soft cap) and
  `showCharacterCount` props on `<TrackChangesEditor>`: a footer shows the
  clean-projection count (`countCleanText` — pending deletions stop counting
  immediately, pending insertions count right away) and flags the over-limit
  state via `.tc-charcount--over`. Input is never hard-blocked (in suggesting
  mode tracked text physically stays in the doc); enforce at submit time via
  the same projection. Requires `track-changes-core >= 0.7.0`.

## 0.9.0

- **Link feature (`createLinkFeature`).** Dependency-free `link` mark
  (`<a href>` with enforced `rel="noopener noreferrer nofollow"`; only
  `http(s)`/`mailto` hrefs parse — pasted `javascript:`/`data:` links are
  rejected at the schema level). "Set link" prompts for a URL
  (host-overridable via `promptUrl` for a proper dialog) and normalizes
  scheme-less input to `https://`; "Remove link" unsets across the mark
  range. In suggesting mode the core rewrite plugin converts the mark toggle
  into a tracked `format_change` suggestion automatically, so links are
  reviewable like any other formatting change. Schema-gated as usual: without
  the feature the mark doesn't exist and pasted links lose their hyperlink.

## 0.8.0

- **External-image localization ("cloud image" paste handling).** The
  image-upload feature never leaves hotlinked `http(s)` images in an editable
  document: a doc-scan reconciler plugin (also catches drag-and-drop and
  programmatic inserts) either localizes them through a new host hook or
  strips them.
  - `createImageUploadFeature({ ingestUrl })` — a host-provided
    `EditorUrlIngestHandler` (`(url) => Promise<EditorUploadResult>`) that
    takes a copy of the remote image (typically via a server-side fetch
    endpoint; browser fetch dies on CORS for most hosts) and resolves with the
    local `src` to swap in. Rejection removes the image instead.
  - Without a handler, external images are stripped on paste.
  - `onImagePaste` callback reports `{ status: 'ingested' | 'rejected' |
    'stripped', url }` so hosts can show a user-facing notice.
  - Read-only views are untouched (legacy stored content still renders);
    localization transactions are tagged so the rewrite plugin never converts
    a failed-import removal into a tracked deletion.

## 0.7.0

- **Formatting is now opt-in at the schema level (breaking-ish default).**
  `<TrackChangesEditor>` configures StarterKit with every formatting-related
  piece disabled (bold, italic, strike, code, headings, lists, blockquote,
  code block, horizontal rule); a new `EditorFeature.starterKitOptions()` hook
  lets features re-enable pieces, and `createFormattingFeature()` re-enables
  exactly what its `buttons` option renders. An editor without the formatting
  feature therefore truly cannot be formatted — no Ctrl+B/I shortcut, no
  markdown input rules, and pasted markup is stripped by the schema (the marks
  don't exist). Structure (paragraphs, hard breaks, history, cursors) stays on.

## 0.6.0

- **P2f — formatting feature (`createFormattingFeature`).** Toolbar buttons
  for bold / italic / strikethrough / heading 2-3 / bullet & numbered lists
  (all StarterKit, so the feature contributes no extensions). Buttons dispatch
  plain Tiptap toggle commands; in suggesting mode the core rewrite plugin
  converts the mark toggles into `format_change` suggestions, so toolbar and
  keyboard (Ctrl+B/I) formatting are tracked identically. `buttons` option
  picks/orders the set; `labels` for i18n.

- **HTML persistence format.** New `format: 'json' | 'html'` prop on
  `<TrackChangesEditor>` (default `'json'`, fully backward compatible). With
  `format="html"`, `update:modelValue` emits the document as an **HTML
  string** — suggestions stay lossless as real `<ins>`/`<del>` tags and
  `data-suggestion-*` attributes — so hosts can store rich text as plain text
  in a DB. The input side is format-agnostic: `modelValue` now accepts a PM
  JSON object **or** an HTML string regardless of `format`.
- New imperative API: `getHTML()` (current tracked doc as HTML) and
  `getCleanHtml()` (accept-all projection as HTML, via the core's new
  `docToHtml`).

## 0.5.0

- **P2e — CKEditor-style editor feature plugins.** New `features/` layer: an
  `EditorFeature` is a self-contained bundle of Tiptap extensions + toolbar
  items + host glue, composed via the new `features` prop — like CKEditor's
  `plugins: [...]` config:
  - `<TrackChangesEditor>` gains `features: EditorFeature[]` and
    `uploadHandler: (file) => Promise<{ src, alt? }>` props, and renders a
    built-in `.tc-toolbar` whenever features contribute items (auto-hidden in
    viewing/readonly state; items re-evaluate `isEnabled`/`isActive` on every
    editor transaction).
  - `createImageUploadFeature(options?)` — registers a minimal inline atom
    `image` node (`TrackedImage`, tracked via the core's marks) plus
    "Insert image" (file picker → host `uploadHandler` → tracked insertion
    when suggesting) and selection-aware "Remove image" buttons. The package
    owns no upload transport — the host decides where bytes go.
  - `createTableFeature(options?)` — registers demo-grade `TrackedTable` /
    `TrackedTableRow` / `TrackedTableCell` nodes (row/cell wrapped with the
    core's `trackableNode()`) plus selection-aware insert-table / add-row /
    delete-row buttons (delete keeps ≥ 1 row so the table stays schema-valid).
  - Shared helpers `featureInsertNode` / `featureDeleteNode` (suggestion
    commands when suggesting, plain edits otherwise) and `pickFile` exported
    for custom features. All labels overridable for i18n via feature options.
- Pair with `@tdg-reports/track-changes-styles` ≥ 0.4.0 for the toolbar and
  feature-node styles.

## 0.4.1

- Accept/reject transactions dispatched by `<TrackChangesEditor>` and
  `useTrackChangesReview` are now tagged with the core's `tagSuggestionTx`, so
  the new rewrite plugin (core 0.5.0) never re-encodes a resolution as a fresh
  suggestion. Requires `@tdg-reports/track-changes-core` ≥ 0.5.0.

## 0.4.0

- **P2b node-level support.** `<TrackChangesEditor>` gains an `extraExtensions`
  prop so the host can add node extensions (Image, Table) whose block/structural
  nodes track changes via the core's `suggestionNodeAttributes()`.
- Exposes `insertNode(node, at?)` and `deleteNode(pos)` on the imperative API,
  plus a new exported `TrackChangesEditorApi` type describing the full exposed
  surface.

## 0.3.0

- Add `useTrackChangesReview(editorRef)` — a headless review composable that
  returns a reactive `suggestions` list (auto-refreshed on every doc change)
  plus `accept` / `reject` / `acceptAll` / `rejectAll` / `getClean` helpers.
  Ships no markup (style-agnostic); the host renders its own review UI. Accept/
  reject dispatch directly on the editor view, so they work even when the
  editor is read-only / viewing.

## 0.2.0

- Export a runtime `VERSION` constant, injected at build time by tsup from
  `package.json` (single-sourced, cannot drift). Reads `0.0.0-dev` when run
  straight from source.

## 0.1.0

- Initial Phase 1 release: `<TrackChangesEditor>` for Vue 3.
- Props: `modelValue` (ProseMirror JSON), `authorId`, `mode`
  (`editing` | `suggesting` | `viewing`), `readonly`.
- Emits `update:modelValue` (debounced via Tiptap `onUpdate`) and `ready`.
- Exposes `accept(id)`, `reject(id)`, `acceptAll()`, `rejectAll()`,
  `listSuggestions()`, `getClean()`, `setSuggesting(on)`.
