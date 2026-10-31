# track-changes-vanilla

## 0.1.0

- Initial release: `createTrackChangesEditor(element, options)` mounts a
  track-changes editor without any UI framework — same options, feature
  plugins, toolbar, counter, and markup as the Vue/React adapters — and
  returns an imperative handle (`setMode`, `setReadonly`, `setAuthor`,
  `getValue`, `setContent`, accept/reject, `destroy`, …).
