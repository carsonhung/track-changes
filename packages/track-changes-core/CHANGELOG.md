# @tdg-reports/track-changes-core

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
