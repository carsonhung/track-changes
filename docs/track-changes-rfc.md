# RFC — Track Changes (Suggesting Mode) for Rich-Text Form Fields

> **Status:** **Phase 1 implemented (v0.36.0).** Headless core + inline-text
> suggesting + Vue adapter + print/screen CSS shipped as standalone
> `@tdg-reports/track-changes-*` packages, exercised by a demo sandbox at
> `/admin/track-changes-demo`. **Not yet wired into the live report flow** —
> P2 (atom nodes/tables + `richtext` field), P3 (React), and P4
> (collaboration) remain future work. See `docs/track-changes-architecture.md`
> for what shipped. Related: tester feedback comment **A4** in
> `docs/tester-feedback-plan.md`.

## 1. Motivation

The legacy TDG **application** system used **CKEditor** track-changes so admins
could let an applicant revise a proposal, then **skim the highlighted changes**
(added text highlighted, deleted text struck through, including images and
tables), **accept** the changes, and save a clean final version.

We want the same capability in the platform — initially for the **report
revise-and-resubmit** flow (tester comment A4), and reusable in **other
projects** (the application system and beyond).

### Target workflow

1. Admin re-opens a submitted report for the PI to revise (a "revise" state).
2. PI edits the form. Edits are tracked as **suggestions**: inserted text
   highlighted, deleted text struck through, **including images and tables**.
3. Admin skims the marked-up document.
4. Admin **accepts** (per-change or accept-all).
5. Suggestion marks are **cleaned up** and the clean version is saved; the
   marked-up version + pre-revision baseline are kept for audit.

## 2. Goals / Non-goals

**Goals**
- Live **suggesting mode** (Word/Google-Docs style), not just a read-only diff.
- Track **inline text, images (atom nodes), and tables**.
- Per-change and bulk **accept/reject**, then **clean export**.
- **Print/PDF hints**: added/deleted markers must render in the printed/PDF copy.
- **Framework-portable**: Vue 3 now, React later, from one core codebase.
- **Standalone, npm-installable plugin** — published as versioned npm packages
  (`npm install @your-org/track-changes-*`), self-contained and consumable by
  *any* project, not just this monorepo. Decoupled from this app's internals.
- **Zero recurring license cost** (no CKEditor/Tiptap-Pro paid features).
- **Quality and maintainability prioritised over delivery speed.**
- **Collaboration-ready** (real-time co-editing) as a later add-on.

**Non-goals (for v1)**
- Replacing the structured form fields (likert, yes/no, date, tags) — those
  keep a simple **before → after** highlight, not inline track-changes.
- Tiptap Platform / Collab Cloud hosting (we self-host).
- Simultaneous *accept/reject by multiple admins* — accept/reject is a
  single-authority (admin) action by design, which avoids the hardest
  concurrency cases.

## 3. Licensing findings (why this stack)

| Component | License | Cost |
|---|---|---|
| ProseMirror | MIT | Free |
| Tiptap editor + core extensions | MIT | Free |
| `@tiptap/extension-collaboration`, `y-prosemirror`, Yjs | MIT | Free |
| **Hocuspocus** collaboration server | MIT | Free (self-hosted) |
| Tiptap **Pro** Tracked Changes / Comments / AI / Version History | Commercial | Paid |
| Tiptap **Platform / Collab Cloud** (managed hosting) | Commercial | Paid |
| CKEditor 5 Track Changes / Revision History | Commercial | Paid |

**Conclusion:** the editor *and* real-time collaboration are fully free and
self-hostable. **Track-changes is the only piece without a free first-party
option — so that is the piece we build.** Everything else is assembled from MIT
parts.

## 4. Architecture decision

**ProseMirror engine, shipped as a Tiptap extension, synced with Yjs.**

- **ProseMirror** — the track-changes engine (most battle-tested rich-text model).
- **Tiptap (MIT core)** — portability layer: the same extension runs under
  `@tiptap/vue-3` and `@tiptap/react`. One codebase, both frameworks.
- **Yjs + Hocuspocus (MIT, self-hosted)** — collaboration, added in a later phase.

We build a **clean headless core** rather than depend on a one-maintainer
experimental library. Existing MIT implementations
(`sungkhum/tiptap-track-changes`, `@handlewithcare/prosemirror-suggest-changes`)
are used as **reference only**, given the quality-over-speed priority.

### 4.1 The keystone rule

> **Represent every suggestion as document data — marks for inline text, node
> attributes for atoms (images) and table cells — never as plugin state /
> decorations.**

Plugin state and decorations **do not sync** over Yjs. By encoding suggestions
as marks/attributes, `y-prosemirror` syncs them through the CRDT automatically,
so suggestions **merge across users for free** and accept/reject become ordinary
transactions that also sync. This single decision is what lets an all-MIT stack
do what the paid products charge for. It must be respected from day one.

## 5. Suggestion data model

- **Inline text** → marks: `insertion` / `deletion` / `markChange`, each with
  `{ id, authorId, ts }`.
- **Atom nodes (images), table rows/cells** → node attributes:
  `{ suggestionId, suggestionType, authorId, ts }` (atoms can't carry marks).
- **Accept** = strip `insertion` marks (keep content) / remove
  `deletion`-marked content / commit the node change.
- **Reject** = the inverse.
- `acceptAll()` → `toClean()` produces the final clean document (workflow step 5).

Persistence: tracked content is stored as ProseMirror JSON (or HTML) in the
report's `formData` JSONB. Three versions are retained via the existing
form-version/snapshot model:
- **baseline** (pre-revise),
- **working** (marked-up suggestions — the audit record),
- **clean** (accepted result).

## 6. Package design (standalone, npm-installable)

The deliverable is a **standalone plugin published to npm** — self-contained,
versioned, and installable into any project with `npm install`. It must not
depend on anything specific to this repo (no imports from `apps/*`, no app
config). This monorepo is just its **first consumer**.

Published as a small family of scoped packages (a monorepo internally, e.g.
pnpm/Turbo workspaces, each folder = one publishable package):

```
@your-org/track-changes-core    # headless: ProseMirror plugins, suggestion
                                 # schema, accept/reject, query API.
                                 # NO Vue/React, NO DOM — testable in isolation.
@your-org/track-changes-collab   # Yjs / y-prosemirror glue (suggestions sync)
@your-org/track-changes-vue      # <TrackChangesEditor> for @tiptap/vue-3
@your-org/track-changes-react    # <TrackChangesEditor> for @tiptap/react
@your-org/track-changes-styles   # screen + @media print CSS for ins/del/nodes
```

Distribution & hygiene (what makes it a real, installable plugin):

- **Published to npm** (public registry, or a private/GitHub Packages scope if
  it must stay internal). Tagged releases, **strict semver**, `CHANGELOG.md`.
- Ship **ESM + CJS** builds with **`.d.ts` types**; correct `exports`,
  `main`/`module`/`types`, `sideEffects`, and `files` in each `package.json`.
- **Headless `core` is the quality anchor**: zero DOM, testable with
  `prosemirror-test-builder`; the framework adapters stay thin.
- **Peer dependencies, not bundled**: ProseMirror, Tiptap, Yjs are declared as
  `peerDependencies` so the host app owns those versions (no duplicate
  ProseMirror instances — a common breakage).
- **No app coupling**: configured purely via constructor options / props;
  persistence and workflow live in the host app, not the package.
- Framework adapters are **optional installs** — a React-only consumer never
  pulls in Vue, and vice-versa.

During development in this repo it can live as a local workspace package
(`packages/track-changes-*`) and be `npm link`-ed, then cut over to the
published npm version once stable — same code, same API.

## 7. Integration with this platform

- Add a **`richtext` form-field type** to the schema-driven renderer
  (`SchemaFormRenderer`), consistent with the "forms are schema-driven" rule.
  Only narrative / table / image fields use it; structured fields are untouched.
- The A4 revise flow drives state: `submitted → (admin re-opens) → revising →
  (PI resubmits) → admin_review`. The baseline is snapshotted on re-open.
- **Print/PDF hints come for free**: suggestions are real `<ins>` / `<del>` /
  node attributes in the HTML, so print CSS makes them render in the
  Browserless-generated PDF of the tracked version; the clean version prints
  without marks.

## 8. Collaboration (later phase)

- Add `@tiptap/extension-collaboration` + a self-hosted **Hocuspocus** server.
- Because suggestions are already marks/attributes, real-time sync is mostly
  wiring, not a redesign.
- Constrain **accept/reject to the admin** (single authority) to avoid
  concurrent-accept intention-preservation edge cases.

## 9. Quality / test strategy

- **Golden-file tests**: document corpus → apply suggestion → accept/reject →
  assert clean and rejected outputs (essential for tables).
- **Property / fuzz tests** for table ops: random row/cell/column
  insert+delete sequences must never corrupt the document.
- **Round-trip invariants**: `toTracked → serialize → deserialize → toClean`
  stable, including through a Yjs sync cycle.
- Strict TypeScript (no `any`); documented, versioned public API.
- Visual-regression on screen + print rendering.

## 10. Phasing

1. **P1** — Headless core + inline text (insert/delete/markChange,
   accept/reject/acceptAll, clean export) + Vue adapter + print CSS + `richtext`
   field type.
2. **P2** — Atom nodes (images) via node-attr tracking.
3. **P3** — Tables (hardest tier; build the fuzz/golden suite here).
4. **P4** — Collaboration (Yjs + self-hosted Hocuspocus).
5. **P5** — React adapter (when the other project needs it).

## 11. Risks

- **Tables + real-time collaboration** is the hardest tier in this space;
  intention-preservation on concurrent overlapping accept/reject has genuine
  edge cases (mitigated by single-authority accept/reject).
- Building in-house means **owning maintenance** — justified here because two+
  projects need it and we avoid a recurring commercial license.
- ProseMirror/Yjs have a real learning curve; budget ramp-up time.

## 12. Alternatives considered

| Option | Verdict |
|---|---|
| CKEditor 5 Track Changes | Closest to legacy behaviour, but **commercial**; rejected on cost + re-doing export/print. |
| Tiptap Pro Tracked Changes | Supports images/tables out of the box, but **paid** + experimental; rejected on cost (acceptable as a temporary bridge if timeline ever tightens). |
| Free MIT Tiptap extensions as a dependency | Good for text, weak on images/tables, single-maintainer; used as **reference**, not a dependency. |
| Read-only diff (`htmldiff-js` / `jsdiff`) | Cheapest, but only *highlights* two saved versions — does **not** provide live suggesting mode (fails the A4 fidelity requirement). |

## 13. Open questions

- Final list of fields that become `richtext` (which report/proposal fields
  genuinely need tables/images).
- Whether the other project needs tables/images or text-only (affects whether
  P3 is required there).
- Whether the clean **or** the tracked version is the canonical archived PDF
  (or both).
