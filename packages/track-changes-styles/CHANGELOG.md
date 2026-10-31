# track-changes-styles

## 0.6.1

- `.tc-charcount-part--over`: per-part over-limit emphasis (bold + red) so a
  word-cap overflow highlights the word segment specifically while the
  character segment stays muted (and vice versa). `.tc-charcount--over` on
  the container keeps the overall red tint.

## 0.6.0

- Table header cells: `.tc-table th` (border + padding shared with `td`,
  tinted background via `--tc-table-header-bg`, bold, left-aligned).
- Character-count footer: `.tc-charcount` (muted, right-aligned, themable
  via `--tc-charcount-fg`) with `.tc-charcount--over`
  (`--tc-charcount-over-fg`) for the soft-limit state; hidden in print.

## 0.5.0

- P2f: tracked-formatting highlight. New `.tc-fmt` (amber background +
  underline shadow, themable via `--tc-fmt-bg` / `--tc-fmt-color`) marking
  text covered by a pending `format_change` suggestion; monochrome underline
  in print.

## 0.4.0

- P2e: feature toolbar + feature node styles. New `.tc-toolbar` /
  `.tc-toolbar-btn` (hover, disabled, `--active` states; themable via
  `--tc-toolbar-*` variables) for the toolbar `<TrackChangesEditor>` renders
  when feature plugins contribute items, hidden in print. New `.tc-img`
  (inline image sizing) and `.tc-table` / `.tc-table td` (collapsed borders,
  padded cells with a min-width so empty cells stay clickable).

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
