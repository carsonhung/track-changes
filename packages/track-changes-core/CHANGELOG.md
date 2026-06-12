# @tdg-reports/track-changes-core

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
