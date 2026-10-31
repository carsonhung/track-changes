# track-changes-vanilla

Framework-free adapter for [`track-changes-core`](../track-changes-core):
mount a Word-style **tracked changes** (suggesting mode) Tiptap editor on any
DOM element — no Vue, no React.

It shares the core editor kit with [`track-changes-vue`](../track-changes-vue)
and [`track-changes-react`](../track-changes-react): same options, same
feature plugins (formatting, link, image upload, tables), same toolbar and
counter markup, so [`track-changes-styles`](../track-changes-styles) applies
unchanged. See the Vue README for the feature plugins, the pasted-image
localization rules, and the host integration contract.

MIT licensed; only the MIT open-source tier of Tiptap is used.

## Install

```bash
npm i track-changes-vanilla track-changes-core track-changes-styles \
      @tiptap/core @tiptap/pm @tiptap/starter-kit
```

## Quick start

```ts
import {
  createTrackChangesEditor,
  createFormattingFeature,
  createImageUploadFeature,
} from 'track-changes-vanilla'
import 'track-changes-styles/track-changes.css'

const editor = createTrackChangesEditor(document.querySelector('#narrative')!, {
  content: '<p>Initial content</p>',
  format: 'html',
  mode: 'suggesting',
  authorId: 'reviewer-1',
  features: [createFormattingFeature(), createImageUploadFeature()],
  uploadHandler: async (file) => ({ src: await myBackend.upload(file) }),
  maxCharacters: 2000,
  onChange: (html) => save(html as string),
  onSuggestionsChange: (list) => renderSidebar(list),
})

// later
editor.setMode('viewing')
editor.accept(id)
editor.getCleanHtml()
editor.destroy()
```

## `createTrackChangesEditor(target, options)`

Appends a `.tc-editor` root to `target` and returns a handle.

| Option | Type | Default | Notes |
|---|---|---|---|
| `content` | `object \| string \| null` | empty doc | ProseMirror JSON **or** HTML. |
| `format` | `'json' \| 'html'` | `'json'` | Format of `onChange` / `getValue()`. |
| `mode` | `'editing' \| 'suggesting' \| 'viewing'` | `'suggesting'` | Change later with `setMode`. |
| `authorId` | `string \| null` | `null` | Change later with `setAuthor`. |
| `readonly` | `boolean` | `false` | Change later with `setReadonly`. |
| `features` | `EditorFeature[]` | `[]` | Feature plugins (fixed for the editor's lifetime). |
| `extraExtensions` | Tiptap `Extensions` | `[]` | Extra raw extensions (fixed). |
| `uploadHandler` | `(file) => Promise<{ src, alt? }>` | `null` | Change later with `setUploadHandler`. |
| `maxCharacters` / `maxWords` | `number \| null` | `null` | Soft caps with a clean-projection counter. |
| `showCharacterCount` | `boolean` | `false` | Show the counter without a cap. |
| `onChange` | `(value) => void` | — | Document in `format`, on every change. |
| `onSuggestionsChange` | `(suggestions) => void` | — | At mount and on every change. |

Handle: `editor` (raw Tiptap), `element`, `getMode()`, `setMode(mode)`,
`setReadonly(b)`, `setAuthor(id)`, `setUploadHandler(fn)`, `getValue()`,
`setContent(value)` (explicit replace — resets history, no `onChange`),
`accept(id)`, `reject(id)`, `acceptAll()`, `rejectAll()`,
`listSuggestions()`, `setSuggesting(on)`, `insertNode()`, `deleteNode()`,
`getClean()`, `getHTML()`, `getCleanHtml()`, `destroy()`.

For a review UI over several editors, `createSuggestionReview(onChange)` is
re-exported from the core: `review.bind(handle.editor)`.

## Versioning

Independent semver; see [CHANGELOG.md](./CHANGELOG.md). A runtime `VERSION`
constant is exported for diagnostics.
