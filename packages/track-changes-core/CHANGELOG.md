# track-changes-core

## 0.9.0

- **Framework-agnostic editor kit + feature plugins.** The feature plugins
  (`createFormattingFeature`, `createLinkFeature`, `createImageUploadFeature`,
  `createTableFeature`, their `Tracked*` nodes/marks, and the
  `featureInsertNode(s)` / `featureDeleteNode(s)` / `pickFile` helpers) moved
  here from `track-changes-vue`, so the Vue, React, and vanilla adapters share
  one implementation. New shared glue: `createEditorCommands` (the imperative
  accept/reject/… API), `createSuggestionReview` (headless review controller),
  `resolveStarterKitOptions`, `characterCountView`, `createModelHydrationGuard`,
  and the `EditorMode` / `EditorFormat` types.
- **Every pasted/dropped image becomes a copy in your storage.**
  - Pasted or dropped image **files** (screenshots, copied files) upload
    through the editor's `uploadHandler` (`uploadPastedFiles`, default on).
  - A pasted bare image / cloud-storage **link** (Google Drive, OneDrive,
    Dropbox, …) is copied via `ingestUrl` and inserted as an image; on
    failure the URL is pasted as text (`pasteImageLinks`: `true` | `false` |
    predicate; `isLikelyImageLink(url)` helper).
  - An "Importing image…" placeholder (`importingImage` label) holds the
    spot while transfers run, mapped through concurrent edits; results are
    tracked insertions while suggesting.
- **Bucket/CDN storage support.** New `localImageOrigins` / `isLocalImageSrc`
  options declare which `http(s)` srcs the platform owns. Previously every
  absolute `http(s)` src counted as external, so storage returning
  `https://bucket…` URLs would be re-ingested (or stripped without
  `ingestUrl`). A storage result that still isn't local is now treated as a
  failed import instead of looping.
- `ImagePasteEvent` gains `source: 'image' | 'link' | 'file'` and an
  `uploaded` status. New `setEditorUploadHandler` / `getEditorUploadHandler`
  let feature plugins reach the editor's upload handler (the adapters
  register it).
- The formatting feature now dispatches Tiptap's generic `toggleMark` /
  `toggleNode` / `toggleList` commands (what StarterKit's `toggleBold` etc.
  wrap), so the core needs no StarterKit dependency. Behavior is unchanged.

## 0.8.0

- **CJK-aware word counting.** `countCleanText` (and the new exported
  `countWords(text)` helper) now follow the MS Word "字数" convention: every
  Han ideograph and Japanese kana character counts as one word, non-CJK text
  still counts whitespace-separated runs, and CJK punctuation (，。「」…)
  separates without counting. Mixed text composes naturally
  ("本项目使用 machine learning 方法" = 9). Previously an unspaced Chinese
  paragraph counted as a single word. Korean is unaffected (Hangul uses
  spaces). Character counting now counts Unicode code points, so emoji and
  surrogate-pair ideographs count as one character instead of two.

## 0.7.0

- **Grouped multi-node suggestions (`suggestInsertNodes` /
  `suggestDeleteNodes`).** Insert or suggest-delete several block/structural
  nodes in one transaction under ONE shared suggestion id, so the whole group
  accepts/rejects atomically — built for table columns (one cell per row =
  one reviewable change), works for any trackable node set. Per-node rules
  match the single-node commands: the author's own un-accepted insertion is
  real-deleted, already-deleted nodes are skipped. No engine change needed —
  `resolve`/`listSuggestions` already treat a shared id as one unit.
- **`countCleanText(doc)`.** Character/word counts of the accept-all
  projection: a pending deletion stops counting immediately, a pending
  insertion counts right away. Characters = text lengths (block breaks and
  atoms excluded); words split on whitespace with block boundaries as
  separators. Backs the Vue editor's character-count footer.

## 0.6.0

- **P2f — tracked formatting changes (`format_change` mark, new
  `formatChange.ts`).** Toggling formatting on existing text in suggesting
  mode is now a reviewable suggestion: the formatting is applied (or removed)
  for real, and a `format_change` mark carrying
  `{ id, authorId, ts, action: 'add' | 'remove', markName }` records the
  toggle (`excludes: ''` so several toggles stack on the same text). Driven by
  the rewrite plugin intercepting plain `AddMarkStep` / `RemoveMarkStep`
  transactions — the exact steps Tiptap's `toggleBold` (toolbar or Ctrl+B)
  dispatches — so there is one tracked path for keyboard and toolbar alike:
  - only segments whose mark presence actually changed are recorded, so
    reject restores exactly the prior formatting (partial-overlap safe)
  - toggling the same mark back while pending **cancels** the suggestion
    instead of stacking a contradictory pair
  - formatting inside a pending insertion is not separately tracked (the
    insertion already carries its final formatting)
  - accept keeps the toggle (strips the mark); reject inverts it;
    `toClean` / `toRejected` / `listSuggestions` (new `type: 'format'` with
    `formatAction` / `formatMark`) / `hasSuggestions` all understand it
  - serializes to `<span data-suggestion-format="add:bold">` — lossless in
    the HTML codec. Raw-schema spec + Tiptap `FormatChangeMark` both shipped;
    block-type changes (headings, lists) remain pass-through by design

- **HTML codec (`html.ts`).** New `docToHtml(doc)` / `htmlToDoc(html, schema)`
  helpers so a tracked document can be persisted as a plain **HTML string**
  (e.g. a text column in a DB) instead of ProseMirror JSON. Lossless by design:
  suggestions are already real `<ins>`/`<del>` tags and `data-suggestion-*`
  attributes, so the round-trip preserves ids, authors, timestamps, and the
  accept/reject semantics (covered by golden-file round-trip tests). Both
  helpers take an optional `options.document` for non-browser environments;
  `htmlHasSuggestions(html)` is a cheap substring sniff for "pending changes"
  badges without parsing.
- **Fix: headless extended schema now serializes node-attribute suggestions.**
  `createExtendedSuggestionSchema()`'s `figure` / `tableRow` / `tableCell`
  specs previously dropped the `suggestion` attribute in `toDOM`/`parseDOM`
  (only the Tiptap extension path rendered it); they now emit and parse
  `data-suggestion` / `data-suggestion-type` / `data-author` / `data-ts`, so
  HTML round-trips are lossless for block/structural suggestions too.

## 0.5.0

- **P2d — transaction-rewrite feature plugin (`createRewriteSuggestingPlugin`,
  new `rewrite.ts`).** The safety net under the prop-based plugins: in
  suggesting mode, any untagged doc-changing transaction is rewritten into
  suggestion form via `appendTransaction`. Closes the IME-composition gap and
  additionally covers drag-and-drop moves (tracked delete + insert) and
  programmatic inline edits:
  - inserted inline content → insertion-marked; wholesale-inserted trackable
    block nodes → `suggestion: insertion` attribute
  - deleted inline content → restored deletion-marked ahead of the insertion
    point (Word-style); the author's own un-accepted insertions are dropped for
    real, so IME composition updates (which repeatedly replace the author's own
    composed text) resolve to a single clean insertion
- **Transaction tagging contract.** New `SUGGESTION_TX_META` /
  `tagSuggestionTx(tr)` / `isRewriteExempt(tr)`: every transaction produced by
  this package's commands is tagged as already suggestion-encoded; undo/redo
  (`history$`) and `addToHistory: false` (external sync) transactions are
  exempt. Hosts dispatching their own resolution transactions (e.g. building on
  `acceptOn`/`rejectOn` directly) must tag them with `tagSuggestionTx`.
- New Tiptap feature extension `TrackChangesRewrite`, composed into the
  `TrackChanges` glue and `createSuggestingPlugins()` (new `rewriteSuggestingKey`).
- Documented remaining pass-through (by design of the mark model): structural
  edits (Enter splits, ReplaceAroundStep wraps), formatting changes, and
  multi-block deletions apply untracked.
- 10 new headless tests (`rewrite.test.ts`) driven through
  `EditorState.apply` → `appendTransaction` — 39 total.

## 0.4.0

- **CKEditor-style modular plugin architecture.** Suggesting mode is now a
  state-owning core plugin plus small, stateless feature plugins (one per input
  surface) that read the shared state:
  - `createTrackChangesStatePlugin(options)` (in `state.ts`) — single owner of
    mode/author state under `trackChangesKey`; new `isSuggesting(state)` helper.
  - `createTextSuggestingPlugin()` — typing + Backspace/Delete.
  - `createClipboardSuggestingPlugin()` — paste + cut (new, see below).
  - `createSuggestingPlugins(options)` — the full composite set.
  - Tiptap mirrors the same split: `TrackChangesCore` / `TrackChangesText` /
    `TrackChangesClipboard` extensions, with the existing `TrackChanges` glue
    extension composing all three (public `createTrackChangesExtension()` API
    unchanged).
  - New `trackableNode(NodeExtension)` per-component integration helper — wraps
    any Tiptap Node so it carries/renders the `suggestion` attribute (the
    one-line equivalent of a CKEditor feature integration plugin).
- **Tracked clipboard.** Paste in suggesting mode becomes a tracked insertion of
  the pasted slice's text (rich/structural pastes flatten to text; a slice with
  no text is blocked rather than applied untracked). Cut writes the clipboard
  manually and records the removal as a tracked deletion (text stays,
  deletion-marked). New `sliceText(slice)` helper.
- **Fix: re-deleting over an existing suggested deletion** no longer re-marks it
  with a new id/author — already-deletion-marked segments are skipped, so a
  second author sweeping the same range can't silently steal or fragment the
  first author's suggestion.
- **Deletion merging.** Consecutive Backspace/Delete presses now merge into one
  suggestion by reusing the id of the adjacent same-author deletion (parity with
  how consecutive typing merges insertions).
- **Breaking:** `createSuggestingPlugin` (singular) removed — use
  `createSuggestingPlugins(options)` (returns the plugin array) or the Tiptap
  extensions. `SuggestingOptions` is now an alias of `TrackChangesStateOptions`.
- Documented limitation: IME composition and structural edits (Enter splits)
  still bypass interception; planned as an `appendTransaction` feature plugin.

## 0.3.0

- **P2b — node-level change tracking.** Extends the keystone rule beyond inline
  text to nodes, with two encodings the accept/reject engine resolves uniformly:
  inline atoms (e.g. inline images) keep using the `insertion`/`deletion`
  **marks**; block/structural nodes (block image, `tableRow`) carry a new
  `suggestion` **node attribute** `{ type, id, authorId, ts }`.
- New `nodeAttrs.ts`: `SUGGESTION_NODE_ATTR`, `NodeSuggestion`,
  `readNodeSuggestion`, `suggestionNodeAttrSpec()`, `isTrackableNode`,
  `suggestionToDomAttrs` / `suggestionFromDom`.
- New commands `suggestInsertNode(node, at?)` (inline → mark, block → attr) and
  `suggestDeleteNode(pos)` (keeps the node, marks it deleted; an author's own
  un-accepted inserted node is removed for real). `markRangeDeleted` now also
  marks inline atoms when sweeping a deleted range.
- `clean.ts` rewritten around a unified suggestion unit (mark or node). Deletions
  resolve via a mapping-based pass (nested suggestions resolve correctly); a
  size-stable second pass strips kept suggestions. `acceptOn`/`rejectOn`/
  `acceptAllOn`/`rejectAllOn`/`toClean`/`toRejected` now cover both encodings.
- `listSuggestions` gains `kind` (`'mark' | 'node'`) and `nodeType`;
  `hasSuggestions` covers node attributes.
- `tiptap.ts`: `suggestionNodeAttributes()` — a Tiptap `addAttributes()` fragment
  to make a host node extension (Image, TableRow) trackable in one spread.
- `schema.ts`: `createExtendedSuggestionSchema()` (image atom, block figure,
  minimal table/row/cell) for headless tests.
- `SuggestionType` is now sourced from `marks.ts` (re-exported) to avoid a
  `nodeAttrs ↔ clean` import cycle.

## 0.2.0

- Export a runtime `VERSION` constant, injected at build time by tsup from
  `package.json` (single-sourced, cannot drift). Reads `0.0.0-dev` when run
  straight from source.

## 0.1.0

- Initial Phase 1 release: headless suggesting-mode engine for inline text.
- `insertion` / `deletion` marks carrying `{ id, authorId, ts }`.
- Suggesting plugin: typed text becomes an `insertion`; deletions become
  `deletion`-marked (an author's own un-accepted insertions are removed for real).
- `acceptOn` / `rejectOn` (by id), `acceptAllOn` / `rejectAllOn` (Transform-based,
  reusable as editor commands and as pure `doc -> doc` projections).
- `toClean` / `toTracked` / `toRejected` projections and `listSuggestions` query.
- `createTrackChangesExtension()` Tiptap (MIT) wrapper + raw ProseMirror plugin.
