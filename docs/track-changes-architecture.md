# Track Changes — Architecture

> **Status:** P1 + P2a + P2b + P2c + P2d + P2e implemented (core 0.5.0 / vue 0.5.0). Headless core
> (inline text **and** node-level: atom images + structural table rows) + Vue
> adapter + print/screen CSS + a demo sandbox at `/admin/track-changes-demo`.
> Live report **revise-and-resubmit** uses inline-text track changes (§6.1);
> node-level tracking is demo-only until a report schema needs image/table
> fields. Companion to `docs/track-changes-rfc.md` (the *why*); this document is
> the *how* of what shipped.

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
  nodeAttrs.ts  `suggestion` node-attribute encoding for block/structural nodes
  state.ts      PluginKey + TrackChangesState + createTrackChangesStatePlugin()
                (the single state-owning core plugin)
  plugin.ts     feature plugins: createTextSuggestingPlugin() (typing, Backspace/
                Delete), createClipboardSuggestingPlugin() (paste, cut), and the
                createSuggestingPlugins() composite
  rewrite.ts    transaction-rewrite feature plugin (appendTransaction safety net:
                IME, drag-and-drop, programmatic edits) + the SUGGESTION_TX_META
                tagging contract (tagSuggestionTx / isRewriteExempt)
  commands.ts   ProseMirror commands (setSuggesting, suggestInsertText,
                suggestInsertNode, acceptSuggestion, …) — used by the Tiptap layer
  clean.ts      pure Transform ops (acceptOn/rejectOn/…) + projections
                (toClean/toRejected/toTracked) + queries (listSuggestions)
  schema.ts     withSuggestionMarks() helper for standalone PM schemas (tests)
  tiptap.ts     InsertionMark, DeletionMark; modular extensions (TrackChangesCore /
                Text / Clipboard / Rewrite) + TrackChanges glue + trackableNode() helper
  index.ts      public barrel
```

### 2.2 Plugin architecture (CKEditor-style composition)

Suggesting mode follows the composition CKEditor 5 uses for track changes: a
**core editing plugin** that owns the state, plus independent, stateless
**feature plugins** — one per input surface — that read that state. Per-component
support (tables, images) plugs in via a one-line integration helper rather than
core changes.

| Layer | Raw ProseMirror | Tiptap |
|---|---|---|
| state core (required) | `createTrackChangesStatePlugin()` | `TrackChangesCore` |
| typing + Backspace/Delete | `createTextSuggestingPlugin()` | `TrackChangesText` |
| paste + cut | `createClipboardSuggestingPlugin()` | `TrackChangesClipboard` |
| everything else (safety net) | `createRewriteSuggestingPlugin()` | `TrackChangesRewrite` |
| everything (glue) | `createSuggestingPlugins()` | `TrackChanges` |
| component integration | `suggestionNodeAttrSpec()` in the NodeSpec | `trackableNode(NodeExtension)` |

Input coverage in suggesting mode:

| Input | Handled by | Tracked as |
|---|---|---|
| typed text | text plugin (`handleTextInput`) | insertion mark |
| Backspace / Delete | text plugin (`handleKeyDown`) | deletion mark (text kept); own un-accepted insertions removed for real; already-deleted segments skipped; consecutive presses merge into one suggestion |
| paste | clipboard plugin (`handlePaste`) | insertion mark over the slice's text (rich pastes flatten to text; text-less slices blocked, never applied untracked) |
| cut | clipboard plugin (`handleDOMEvents.cut`) | clipboard written manually; selection becomes a tracked deletion |
| IME composition | rewrite plugin (`appendTransaction`) | inserted text insertion-marked; the author's own replaced composition text is dropped for real, so each composition resolves to one clean insertion |
| drag-and-drop move | rewrite plugin | tracked deletion at the source + tracked insertion at the drop point |
| programmatic / other untagged inline edits | rewrite plugin | inserted inline content insertion-marked; deleted inline content restored deletion-marked |
| **structural edits** (Enter split, ReplaceAroundStep wraps) | **pass through untracked** | the mark model cannot encode a split/wrap as document data (CKEditor uses block attributes here); documented limitation |
| **formatting changes** (bold toggle, etc.) | **pass through untracked** | format suggestions are out of scope for now |
| **multi-block deletions** via untagged transactions | **pass through untracked** | restoring structural slices safely needs block-level encoding; inline-only slices are restored |

The rewrite plugin (P2d, `rewrite.ts`) is the safety net under the prop-based
plugins: in suggesting mode it rewrites any **untagged** doc-changing
transaction into suggestion form. The tagging contract: every transaction
produced by this package's commands (and the Vue adapter's accept/reject) is
tagged with `SUGGESTION_TX_META` via `tagSuggestionTx(tr)`; undo/redo
(`history$`) and `addToHistory: false` (external sync) transactions are exempt
(`isRewriteExempt`). Hosts dispatching their own resolution transactions must
tag them the same way.

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
            text/clipboard feature   │ intercepts (see §2.2)
            plugins                  ▼
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
2. **[done]** `SchemaFormRenderer` renders `richtext` fields through the app's
   `RichtextField.vue` wrapper, **lazy-loaded** (`defineAsyncComponent`) so the
   heavy Tiptap/ProseMirror chunk is fetched only when a schema actually
   contains a richtext field — text/likert-only report forms stay lean. Mode
   derives from `readonly` (→ `viewing`) else the field's `richtextMode`.
   Demonstrated on `/admin/track-changes-demo` ("As a schema form field").
   Adding a richtext field to a real form is therefore a **JSON schema
   change**, not code.
3. **[done, v0.37.0]** Report "revise" state (tester A4) — see §6.1 below.
4. **[free]** PDF export already works because marks are real `<ins>`/`<del>`
   elements.
5. **[done, v0.46.0]** Editor features per field — `FormField` gains
   `richtextFeatures?: string[]` (e.g. `['imageUpload', 'table']`); the schema
   flag is resolved by `RichtextField.vue`'s registry (code → P2e
   `EditorFeature` factory with i18n labels + the default data-URL upload
   handler). Section 5 of the 2026 report form and the backend-seeded PI
   submission form (republished v1.1) enable both features, so PIs can embed
   figures and tables in narratives — tracked like any text edit during
   revise-and-resubmit. Enabling a feature on another field is a **schema
   change**, adding a new feature is one registry entry.

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
| **P2b** | atom nodes (images) + block/structural nodes (table rows) — see §9 | **done (core 0.3.0 / vue 0.4.0)** |
| **P2c** | modular plugin architecture (CKEditor-style, §2.2) + tracked clipboard (paste/cut) + deletion re-mark guard & merging | **done (core 0.4.0)** |
| **P2d** | `appendTransaction` rewrite plugin — IME composition, drag-and-drop, programmatic edits + the `SUGGESTION_TX_META` tagging contract (§2.2); structural edits remain pass-through by design of the mark model | **done (core 0.5.0 / vue 0.4.1)** |
| **P2e** | editor feature plugins (CKEditor-style, §10) — `EditorFeature` contract, built-in toolbar, image-upload + table features, host upload glue | **done (vue 0.5.0 / styles 0.4.0)** |
| P3 | React adapter from the same core | future |
| P4 | collaboration (CRDT/OT) over the same mark model | future |

## 9. P2b — node-level change tracking (atoms + structural nodes)

P1 tracked only inline **text**. P2b extends the same keystone rule ("suggestions
are document data") to nodes, using **two encodings** resolved uniformly by the
accept/reject engine:

| Content | Encoding | Why |
|---|---|---|
| text | `insertion` / `deletion` **mark** | P1, unchanged |
| inline atom (inline image) | `insertion` / `deletion` **mark** | marks are allowed on inline atoms; renders as `<ins><img></ins>` |
| block / structural node (block image, `tableRow`) | `suggestion` **node attribute** `{type,id,authorId,ts}` | a block can't carry an inline mark; the attribute serializes + renders to `data-suggestion-type` |

Both encodings live in the document (mark attrs / node attrs), so persistence,
print/PDF and future Yjs sync work the same as for text.

### 9.1 Core surface added

- `nodeAttrs.ts` — `SUGGESTION_NODE_ATTR`, `NodeSuggestion`, `readNodeSuggestion`,
  `suggestionNodeAttrSpec()` (raw PM), `suggestionToDomAttrs` / `suggestionFromDom`,
  `isTrackableNode`.
- `commands.ts` — `markRangeDeleted` now also marks inline atoms; new
  `suggestInsertNode(node, at?)` (inline → mark, block → attr) and
  `suggestDeleteNode(pos)` (keeps the node, marks it deleted; an author's own
  un-accepted inserted node is removed for real).
- `clean.ts` — the accept/reject engine was rewritten around a unified "suggestion
  unit" (mark or node). Deletions resolve via a **mapping-based** pass so deleting
  an ancestor collapses descendant ranges correctly (nested suggestions);
  keep/strip is a size-stable second pass. `listSuggestions` gains `kind` +
  `nodeType`; `hasSuggestions` covers both encodings.
- `tiptap.ts` — `suggestionNodeAttributes()` is a Tiptap `addAttributes()`
  fragment so a host node extension (Image, TableRow) becomes trackable with one
  spread, rendering the `data-*` + `tc-node-ins` / `tc-node-del` classes.
- `schema.ts` — `createExtendedSuggestionSchema()` (image atom, block figure,
  minimal table/row/cell) backs the headless `nodes.test.ts` suite.

### 9.2 Vue + styles + demo

- `<TrackChangesEditor>` gains an `extraExtensions` prop (host adds Image/Table
  node extensions) and exposes `insertNode(node, at?)` / `deleteNode(pos)`
  (`TrackChangesEditorApi`).
- `track-changes-styles` adds atom-image outlines and block `.tc-node-ins` /
  `.tc-node-del` styling, with `@media print` variants.
- `/admin/track-changes-demo` seeds an inline image + a 3-row table and adds an
  "Node-level changes (P2b)" toolbar (insert/delete image, insert/delete row);
  the existing `SuggestionReviewPanel` accept/reject already drives node
  suggestions (it now labels text-less node changes by node type).

Not yet wired into a live report form (the report schema has no image/table
fields today); doing so is a schema change per the platform rule, not core code.

## 10. P2e — editor feature plugins (CKEditor-style features)

P2c made *suggesting-mode interception* modular; P2e extends the same idea to
*editor capabilities*. In CKEditor a feature is not just engine code — it
bundles the engine plugin **plus its UI** (toolbar button) **plus platform
glue** (e.g. an upload adapter). The Vue adapter now mirrors that:

```ts
// features/types.ts (track-changes-vue)
interface EditorFeature {
  name: string
  extensions?: () => AnyExtension[]        // engine: Tiptap nodes/marks/plugins
  toolbarItems?: () => EditorToolbarItem[] // UI: rendered by the built-in toolbar
}
type EditorUploadHandler = (file: File) => Promise<{ src: string; alt?: string }>
```

- `<TrackChangesEditor :features="[...]" :upload-handler="...">` composes
  features like CKEditor's `plugins: [...]` config. The component renders a
  `.tc-toolbar` whenever features contribute items (auto-hidden in
  viewing/readonly); items re-evaluate `isEnabled` / `isActive` against the
  live editor on every transaction (an `editorTick` ref subscribes the render).
- **Track-changes awareness is the feature author's job**, made trivial by the
  shared helpers `featureInsertNode` / `featureDeleteNode`: suggestion commands
  (`suggestInsertNode` / `suggestDeleteNode`) when suggesting, plain edits when
  editing. Feature edits are therefore reviewable suggestions like any other.
- **Upload glue stays in the host.** The package never talks to a backend; the
  app's `lib/editorUploads.ts` provides a data-URL handler (demo / mock phase)
  and `createAttachmentUploadHandler(entityType, entityId)` which records the
  file through the generic `/api/attachments` endpoint (storage adapter, audit,
  access control) while embedding a self-contained data-URL `src` — the
  download endpoint needs an Authorization header `<img>` can't send; when the
  backend grows signed inline URLs only this handler changes.

Built-in features (both label-overridable for i18n):

| Feature | Engine | Toolbar |
|---|---|---|
| `createImageUploadFeature()` | `TrackedImage` inline atom (tracked via marks, P2b) | Insert image (picker → upload → tracked insert), Remove image (selection-aware) |
| `createTableFeature()` | `TrackedTable` / `TrackedTableRow` / `TrackedTableCell` (row/cell via `trackableNode()`) | Insert table, Add row, Delete row (selection-aware; keeps ≥ 1 row so the table stays schema-valid) |

The demo page composes both features and dropped its bespoke "Node-level
changes" button card and local node-extension module — the P2b §9.2 toolbar is
superseded by the feature toolbar. The table nodes remain demo-grade (no column
ops / resizing); swap the node set for `prosemirror-tables` inside the same
feature when a real schema needs it.

## 8. Testing

- **core** — `vitest` golden-file tests with `prosemirror-test-builder`:
  apply → accept/reject → assert clean doc; round-trip invariants
  (`toClean(toTracked) == toClean`). No DOM, no browser.
- **vue** — `tsc --noEmit` + `tsup` build gate; exercised end-to-end by the
  demo page.
- **frontend** — demo page is the manual sandbox (suggesting toggle, author
  switch, per-change + bulk accept/reject, clean preview, print preview,
  PM-JSON inspector).
