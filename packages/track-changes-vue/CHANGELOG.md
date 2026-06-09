# @tdg-reports/track-changes-vue

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
