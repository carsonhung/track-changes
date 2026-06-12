# @tdg-reports/track-changes-vue

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
