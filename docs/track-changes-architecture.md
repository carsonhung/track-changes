# Track Changes — Architecture

> **Status:** Phase 1 implemented (v0.36.0). Headless core + Vue adapter +
> print/screen CSS + a demo sandbox at `/admin/track-changes-demo`. **Not yet
> wired into the live report flow.** Companion to `docs/track-changes-rfc.md`
> (the *why*); this document is the *how* of what shipped.

## 1. Layering at a glance

```
                 ┌─────────────────────────────────────────────┐
                 │  App (apps/frontend)                          │
                 │  TrackChangesDemoPage.vue, future report form │
                 └───────────────┬───────────────────────────────┘
                                 │ imports
        ┌────────────────────────┼────────────────────────┐
        ▼                        ▼                         ▼
┌───────────────────┐  ┌────────────────────┐   ┌────────────────────────┐
│ track-changes-vue │  │ track-changes-     │   │ track-changes-styles   │
│ <TrackChangesEditor>│ │ core (headless)    │   │ ins/del screen+print   │
│ @tiptap/vue-3 glue │  │ marks, plugin,     │   │ CSS (framework-free)   │
└─────────┬─────────┘  │ commands, clean    │   └────────────────────────┘
          │            └──────────┬─────────┘
          │ depends on            │ peer deps
          ▼                       ▼
   ┌──────────────────────────────────────────────┐
   │ Tiptap (MIT)  @tiptap/core, /vue-3, /starter-kit│
   └──────────────────────┬─────────────────────────┘
                          ▼
   ┌──────────────────────────────────────────────┐
   │ ProseMirror (MIT) — @tiptap/pm                 │
   │ model · transform · state · view               │
   └──────────────────────────────────────────────┘
```

**Why two layers under us.** ProseMirror is the actual rich-text engine
(document model, transactions, schema, marks). Tiptap is a thin MIT-licensed
ergonomics layer on top of ProseMirror (an `Editor` class, an extension
system, a Vue binding). We use Tiptap for *editor convenience* but write all
track-changes logic against **raw ProseMirror primitives** so the core stays
framework- and Tiptap-version-agnostic and is unit-testable with no DOM.

See `docs/track-changes-rfc.md` §3 for the licensing findings — everything in
this stack is MIT.

## 2. Packages

| Package | Layer | Depends on | Ships |
|---|---|---|---|
| `@tdg-reports/track-changes-core` | headless | `@tiptap/core` + `@tiptap/pm` (peer) | ESM + CJS + `.d.ts` |
| `@tdg-reports/track-changes-vue` | Vue adapter | core + `@tiptap/vue-3` + `vue` (peer) | ESM + CJS + `.d.ts` |
| `@tdg-reports/track-changes-styles` | CSS | none | `track-changes.css` |

All three live under `packages/` in this monorepo, are built with **tsup**
(ESM+CJS+dts) and are independently publishable to npm — nothing in them
imports app code, so they can be lifted into the future application system or
released open-source unchanged.

### 2.1 `track-changes-core` internals

```
src/
  ids.ts        createSuggestionId() — unique mark ids
  marks.ts      insertion & deletion MarkSpecs ({id, authorId, ts})
  state.ts      PluginKey + TrackChangesState (suggesting on/off, authorId)
  plugin.ts     createSuggestingPlugin() — intercepts input/keys
  commands.ts   ProseMirror commands (setSuggesting, suggestInsertText,
                acceptSuggestion, …) — used by the Tiptap layer
  clean.ts      pure Transform ops (acceptOn/rejectOn/…) + projections
                (toClean/toRejected/toTracked) + queries (listSuggestions)
  schema.ts     withSuggestionMarks() helper for standalone PM schemas (tests)
  tiptap.ts     InsertionMark, DeletionMark, TrackChanges extension wrapper
  index.ts      public barrel
```

## 3. The keystone rule — suggestions are document data, not plugin state

This is the single most important design decision (RFC §4.1). A suggestion is
**not** stored in plugin state or a side table; it is encoded **in the document
itself** as a ProseMirror **mark** on the affected text:

- **Insertion** → text carries an `insertion` mark.
- **Deletion** → text is **kept** in the document but carries a `deletion`
  mark (it is *not* removed until accepted).

Each mark carries `{ id, authorId, ts }`:

```ts
insertion: { attrs: { id, authorId, ts } }  // rendered as <ins data-…>
deletion:  { attrs: { id, authorId, ts } }  // rendered as <del data-…>
```

**Why this matters:**

- **Persistence is trivial** — saving the ProseMirror JSON saves the
  suggestions. No second table, no reconciliation.
- **Print/PDF for free** — marks serialize to real `<ins>`/`<del>` elements,
  so `track-changes-styles` (incl. `@media print`) makes them render in
  Browserless-generated PDFs.
- **Collaboration-ready** — because changes are document content, a future
  CRDT/OT layer (RFC §8) syncs them like any other edit; nothing special.
- **Pure, testable transforms** — accept/reject are functions over a
  `Transform`, runnable headless with `prosemirror-test-builder`.

## 4. Data flow

### 4.1 Typing in suggesting mode

```
user types ──▶ Tiptap Editor ──▶ ProseMirror tr
                                     │
              createSuggestingPlugin │ intercepts
                                     ▼
   new text gets `insertion` mark (current authorId, fresh id, ts)
   backspace/delete over normal text ──▶ adds `deletion` mark (text kept)
   backspace over own un-accepted insertion ──▶ truly removed
                                     │
                                     ▼
                         doc updated ──▶ onUpdate ──▶ emit update:modelValue
```

In **editing** mode the plugin is inert (normal editing). In **viewing** mode
the editor is non-editable and simply renders the marks.

### 4.2 Accept / reject

```
acceptOn(tr, id):  insertion → unwrap mark (text stays);  deletion → delete text
rejectOn(tr, id):  insertion → delete text;               deletion → unwrap mark
acceptAllOn / rejectAllOn: same, swept across the whole doc
toClean(doc):   == accept all   (the version that gets saved)
toRejected(doc):== reject all   (the pre-revision baseline)
toTracked(doc): identity        (the marked-up version, kept for audit)
```

These are pure (operate on a `Transform`), so the Vue adapter, a React adapter,
a CLI, or a server-side cleanup job can all reuse them.

## 5. Vue adapter contract

`<TrackChangesEditor>` is a thin shell over a Tiptap `Editor` (StarterKit +
the TrackChanges extension):

| Prop | Meaning |
|---|---|
| `modelValue` | ProseMirror JSON doc (one-way after mount — re-key to reload) |
| `authorId` | who new suggestions are attributed to |
| `mode` | `editing` \| `suggesting` \| `viewing` |
| `readonly` | force non-editable |

| Emit / expose | |
|---|---|
| `@update:modelValue` | fires on every doc change (autosave hook) |
| `@ready` | the Tiptap `Editor` instance |
| exposed: `accept/reject/acceptAll/rejectAll` | imperative accept/reject |
| exposed: `listSuggestions()` | `[{id,type,authorId,text,…}]` for a sidebar |
| exposed: `getClean()` | the accept-all JSON to persist |

**One-way binding** is deliberate: the editor owns its document to avoid
cursor-jump feedback loops. Loading a different document = change the `:key`.

### 5.1 `useTrackChangesReview(editorRef)` — headless review primitive

For building a review surface (admin accepting a PI's suggestions), the Vue
adapter also exports a **headless composable** (no markup, style-agnostic):

```ts
const review = useTrackChangesReview(editorRef) // editorRef = <TrackChangesEditor> template ref
// review.suggestions   → Ref<SuggestionSummary[]>  (auto-refreshed on every doc change)
// review.hasSuggestions → Ref<boolean>
// review.accept(id) / reject(id) / acceptAll() / rejectAll()
// review.getClean()    → accept-all JSON to persist
```

It binds to the editor's Tiptap `update` event to keep `suggestions` reactive,
and accept/reject dispatch directly on the editor view — so they work even when
the editor is **read-only / viewing** (read-only blocks *user* typing, not
programmatic review actions). The host renders its own sidebar/inline UI; the
package ships none.

The app's styled consumer of this composable is
`components/common/SuggestionReviewPanel.vue` (shadcn Card + per-change/bulk
accept/reject, props `editorRef` / `authorLabels`, emits `change`). The package
stays headless; the styled, terminology-aware panel lives in the app — the same
split as the editor itself. The demo page and the future report revise-and-
resubmit admin review both consume this one panel.

## 6. How this maps onto the platform

Per the platform-extensibility rule, the live integration is **config + schema**,
not new core code. All four steps below are **implemented** (the live report
revise-and-resubmit wiring landed in v0.37.0 — see §6.1).

1. **[done]** `richtext` field type — `FormField.type` accepts `'richtext'`
   (value = ProseMirror JSON, not a string), with an optional
   `richtextMode: 'editing' | 'suggesting' | 'viewing'`.
2. **[done]** `SchemaFormRenderer` renders `richtext` fields with
   `<TrackChangesEditor>`, **lazy-loaded** (`defineAsyncComponent`) so the heavy
   Tiptap/ProseMirror chunk is fetched only when a schema actually contains a
   richtext field — text/likert-only report forms stay lean. Mode derives from
   `readonly` (→ `viewing`) else the field's `richtextMode`. Demonstrated on
   `/admin/track-changes-demo` ("As a schema form field"). Adding a richtext
   field to a real form is therefore a **JSON schema change**, not code.
3. **[done, v0.37.0]** Report "revise" state (tester A4) — see §6.1 below.
4. **[free]** PDF export already works because marks are real `<ins>`/`<del>`
   elements.

### 6.1 Live report revise-and-resubmit (v0.37.0)

Wired into the existing revise flow (an admin `revise` clarification re-opens the
report as a draft). No DB migration was needed — the richtext value is a
ProseMirror JSON doc stored inside the existing `formData` blob, and the marks
fully encode both the baseline (reject-all) and the proposed text (accept-all),
so no separate baseline column is required.

- **Schema** — Section 5 ("Report on Project Progress") narrative fields are
  `richtext`. Switching a field from `textarea` to `richtext` is loss-free:
  `SchemaFormRenderer` coerces any legacy/seeded string into a paragraph doc.
- **PI/PC (suggesting)** — while an open `revise` clarification exists,
  `ReportDetailPage` passes `richtextModeOverride="suggesting"` so the
  applicant's edits land as tracked insertions/deletions over their previous
  submission instead of silently overwriting it. On resubmit, `formData` carries
  the tracked docs.
- **Admin (review)** — the resubmitted form renders read-only (`viewing`, inline
  `<ins>`/`<del>`). A page-level review panel calls the renderer's exposed
  `acceptAllSuggestions()` / `rejectAllSuggestions()` (which drive every richtext
  editor at once, via the core — no duplicated logic), then persists the cleaned
  docs through `PATCH /form-data` and reloads. Pending-revision detection is a
  pure JSON mark scan, so no editor needs mounting just to show the "N tracked
  changes" badge.
- **Backend** — `patchReportFormData` now permits admins to save during
  `submitted` / `admin_review` (the documented "admin edits the report directly"
  rule), recorded as a `report.admin_edited` audit entry. PI/PC remain
  restricted to `draft`.
- **Per-change admin review** of a single field reuses `SuggestionReviewPanel`
  (§5.1) bound to that field's editor; the multi-field report form uses the
  bulk accept/reject path above.

## 7. Phasing

| Phase | Scope | Status |
|---|---|---|
| **P1** | headless core + inline text + Vue adapter + print CSS + demo + `richtext` field type (schema-renderer seam) | **done (v0.36.0 / .2)** |
| **P2a** | headless `useTrackChangesReview` + reusable `SuggestionReviewPanel`; **live report revise-and-resubmit wiring** (tester A4) | **done (v0.36.4 / 0.37.0)** |
| P2b | atom nodes (images), tables | next |
| P3 | React adapter from the same core | future |
| P4 | collaboration (CRDT/OT) over the same mark model | future |

## 8. Testing

- **core** — `vitest` golden-file tests with `prosemirror-test-builder`:
  apply → accept/reject → assert clean doc; round-trip invariants
  (`toClean(toTracked) == toClean`). No DOM, no browser.
- **vue** — `tsc --noEmit` + `tsup` build gate; exercised end-to-end by the
  demo page.
- **frontend** — demo page is the manual sandbox (suggesting toggle, author
  switch, per-change + bulk accept/reject, clean preview, print preview,
  PM-JSON inspector).
