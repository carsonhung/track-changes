# @tdg-reports/track-changes-styles

## 0.3.0

- P2b: style node-level suggestions. Inline atom images get a coloured
  solid/dashed outline (`.tc-ins img` / `.tc-del img`); block/structural nodes
  (e.g. table rows) styled via `.tc-node-ins` / `.tc-node-del` (left bar + tint,
  struck-through cells for deleted rows). All with `@media print` variants so
  they render in Browserless PDFs.

## 0.2.0

- Versioned alongside `track-changes-core` / `track-changes-vue` (0.2.0).
- No CSS changes; release bump to keep the three packages in lockstep.

## 0.1.0

- Initial Phase 1 release: screen + `@media print` CSS for `<ins>` / `<del>`
  so tracked insertions/deletions render in print and Browserless PDFs, and a
  clean (accepted) document prints without any markers.
