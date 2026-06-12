# @tdg-reports/track-changes-core

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
