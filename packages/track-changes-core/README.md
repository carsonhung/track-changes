# track-changes-core

Headless track-changes ("suggesting mode") engine for ProseMirror / Tiptap.
Framework-free: no Vue, no React, no DOM requirement (HTML codec accepts an
injected DOM for Node-side use), **no environment variables, no network IO**
¡X it transforms documents and nothing else. UI adapters (e.g.
[`track-changes-vue`](../track-changes-vue)) sit on top.

AGPL-3.0 or commercial license, see [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md); built only on MIT-tier Tiptap/ProseMirror packages.

## Keystone rule

Every suggestion is **document data** ¡X marks/attributes carrying
`{ id, authorId, ts }` ¡X never plugin state or decorations. Consequences:

- suggestions persist in the serialized document (PM JSON *or* HTML)
- they render as real `<ins>` / `<del>` elements in print and PDF
- collaboration (Yjs) needs no redesign ¡X the data travels with the doc

Encodings:

| Change | Encoding |
|---|---|
| Inserted text / inline atoms | `insertion` mark ¡÷ `<ins data-suggestion ¡K>` |
| Deleted text / inline atoms | `deletion` mark (content kept) ¡÷ `<del data-suggestion ¡K>` |
| Block/structural nodes (table rows, figures) | `suggestion` node attribute ¡÷ `data-suggestion` + `data-suggestion-type` |
| Formatting toggles (bold/italic/strike) | `format_change` mark ¡÷ `<span data-suggestion-format ¡K>` |

## What's in the box

- **Marks & node attrs** ¡X `insertionMarkSpec`, `deletionMarkSpec`,
  `formatChangeMarkSpec`, `suggestionNodeAttrSpec`, DOM (de)serialization
  helpers.
- **Commands** ¡X `suggestInsertText`, `suggestDeleteBackward/Forward`,
  `suggestInsertNode`, `suggestDeleteNode`, `acceptSuggestion`,
  `rejectSuggestion`, accept/reject-all.
- **Rewrite plugin** ¡X `createRewriteSuggestingPlugin()` intercepts ordinary
  transactions (typing, deletes, mark toggles ¡X including from third-party
  plugins and toolbars) and rewrites them into suggestion form while
  suggesting. Escape hatch: `tagSuggestionTx(tr)` marks a transaction exempt.
- **Projections** ¡X `toClean(doc)` (accept all), `toRejected(doc)` (reject
  all), `toTracked(doc)`; `listSuggestions(doc)` / `hasSuggestions(doc)` for
  review UIs.
- **HTML codec** ¡X `docToHtml(doc)` / `htmlToDoc(html, schema)` (lossless
  round-trip incl. all suggestion encodings; DOM-injectable for headless
  callers) and `htmlHasSuggestions(html)` (cheap pending-changes sniff). This
  is what lets hosts store rich text as a plain `TEXT` column.
- **Tiptap bundle** ¡X `TrackChanges` extension (or the granular
  `TrackChangesCore` / `Text` / `Clipboard` / `Rewrite` pieces),
  `trackableNode()` / `suggestionNodeAttributes()` to make custom block nodes
  trackable.
- **Schemas** ¡X `createBasicSuggestionSchema()` /
  `createExtendedSuggestionSchema()` for headless/test use.

## Quick start (headless)

```ts
import {
  createExtendedSuggestionSchema,
  htmlToDoc, docToHtml, toClean, listSuggestions,
} from 'track-changes-core'

const schema = createExtendedSuggestionSchema()
const doc = htmlToDoc(storedHtml, schema)        // e.g. from a DB TEXT column

listSuggestions(doc)                              // pending changes for a review UI
const finalDoc = toClean(doc)                     // accept-all projection
const finalHtml = docToHtml(finalDoc)             // store / print / PDF
```

In Node (no browser), pass a DOM implementation (e.g. `happy-dom`) via
`HtmlCodecOptions` ¡X the test suite shows the pattern (`src/html.test.ts`).

## Tests

`npm run test` ¡X vitest golden-file suites covering insert/delete/accept/
reject, node-level suggestions, format-change tracking, clipboard, the
rewrite interception, and HTML round-trips.

## Versioning

Independent semver; see [CHANGELOG.md](./CHANGELOG.md). Runtime `VERSION`
constant exported.
