# @tdg-reports/track-changes-styles

Screen + print CSS for the track-changes packages: green underlined `<ins>`,
red struck-through `<del>`, amber highlight for pending `format_change`
spans (`.tc-fmt`), with print-media rules so tracked output is readable in
PDFs.

Pure CSS — no JavaScript, no environment variables, no build step. Optional:
hosts can ship their own styles instead; the editor only requires that
`ins`/`del`/`data-suggestion-*` get *some* styling to be visually useful.

```ts
import '@tdg-reports/track-changes-styles/track-changes.css'
```

MIT licensed. See [CHANGELOG.md](./CHANGELOG.md).
