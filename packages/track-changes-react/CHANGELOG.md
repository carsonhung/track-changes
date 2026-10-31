# track-changes-react

## 0.1.1

- **License is now Apache 2.0** (was MIT). Earlier versions remain MIT.
- Fix: content hydrated after mount in `suggesting` mode was recorded as one
  large insertion. Hydration now uses core's `replaceEditorContent`
  (untracked, not undoable).

## 0.1.0

- Initial release: React 18/19 `<TrackChangesEditor>` on `@tiptap/react`,
  feature-for-feature with `track-changes-vue` 0.12 (modes, formats,
  feature plugins, upload handler, character/word counter, late hydration,
  identical markup), an imperative `ref` API, and the
  `useTrackChangesReview(editor)` hook. StrictMode-safe.
