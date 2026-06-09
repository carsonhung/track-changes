# @tdg-reports/track-changes-vue

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
