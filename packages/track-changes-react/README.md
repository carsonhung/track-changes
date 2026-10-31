# track-changes-react

React 18/19 adapter for [`track-changes-core`](../track-changes-core): a
`<TrackChangesEditor>` component built on `@tiptap/react` with CKEditor-style
**feature plugins** (formatting, link, image upload, tables) and Word-style
**tracked changes** (suggesting mode).

It is feature-for-feature with [`track-changes-vue`](../track-changes-vue):
both adapters are thin wrappers over the same core editor kit and render the
same markup, so [`track-changes-styles`](../track-changes-styles) applies
unchanged. See the Vue README for the feature plugins, the pasted-image
localization rules, and the host integration contract ¡X all of it applies
here as-is.

AGPL-3.0 or commercial license, see [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md); only the MIT open-source tier of Tiptap is used.

## Install

```bash
npm i track-changes-react track-changes-core track-changes-styles \
      @tiptap/core@^2 @tiptap/pm@^2 @tiptap/starter-kit@^2 @tiptap/react@^2 react react-dom
```

## Quick start

```tsx
import { useRef, useState } from 'react'
import type { Editor } from '@tiptap/react'
import {
  TrackChangesEditor,
  useTrackChangesReview,
  createFormattingFeature,
  createTableFeature,
  type TrackChangesEditorRef,
} from 'track-changes-react'
import 'track-changes-styles/track-changes.css'

// Create features once (module scope or useMemo): they are read at mount.
const features = [createFormattingFeature(), createTableFeature()]

export function ReviewField() {
  const [html, setHtml] = useState<string>('<p>Initial content</p>')
  const [editor, setEditor] = useState<Editor | null>(null)
  const ref = useRef<TrackChangesEditorRef>(null)
  const review = useTrackChangesReview(editor)

  return (
    <>
      <TrackChangesEditor
        ref={ref}
        value={html}
        onChange={(v) => setHtml(v as string)}
        onReady={setEditor}
        format="html"
        mode="suggesting"
        authorId="reviewer-1"
        features={features}
        maxWords={500}
      />
      <ul>
        {review.suggestions.map((s) => (
          <li key={s.id}>
            {s.type}: {s.text}
            <button onClick={() => review.accept(s.id)}>Accept</button>
            <button onClick={() => review.reject(s.id)}>Reject</button>
          </li>
        ))}
      </ul>
    </>
  )
}
```

## `<TrackChangesEditor>` props

| Prop | Type | Default | Notes |
|---|---|---|---|
| `value` | `object \| string \| null` | `null` | ProseMirror JSON **or** HTML. Read at mount; a still-empty editor accepts one later hydration (async-loaded data). After that the editor owns its document, so feeding `onChange` output back in is safe. Remount via `key` to load a different document. |
| `onChange` | `(value) => void` | ¡X | Document in `format`, on every change. |
| `format` | `'json' \| 'html'` | `'json'` | `html` is lossless (`<ins>`/`<del>` + `data-suggestion-*`). |
| `mode` | `'editing' \| 'suggesting' \| 'viewing'` | `'suggesting'` | Live-switchable. |
| `authorId` | `string \| null` | `null` | Attributed on new suggestions. Live-switchable. |
| `readonly` | `boolean` | `false` | Live-switchable. |
| `features` | `EditorFeature[]` | `[]` | Feature plugins. Read at mount. |
| `extraExtensions` | Tiptap `Extensions` | `[]` | Extra raw extensions. Read at mount. |
| `uploadHandler` | `(file) => Promise<{ src, alt? }>` | `null` | Host upload transport for the image feature. |
| `maxCharacters` / `maxWords` | `number \| null` | `null` | Soft caps with a clean-projection counter (never hard-blocks input). |
| `showCharacterCount` | `boolean` | `false` | Show the counter without a cap. |
| `onReady` | `(editor) => void` | ¡X | Receives the Tiptap editor (again after a remount). |
| `className` | `string` | ¡X | Extra class on the `.tc-editor` root. |

Imperative API via `ref` (`TrackChangesEditorRef`): `accept(id)`,
`reject(id)`, `acceptAll()`, `rejectAll()`, `listSuggestions()`,
`setSuggesting(on)`, `insertNode(node, at?)`, `deleteNode(pos)`,
`getClean()`, `getHTML()`, `getCleanHtml()`, and the raw Tiptap `editor`.

`useTrackChangesReview(editor)` returns `{ suggestions, hasSuggestions,
accept, reject, acceptAll, rejectAll, getClean, refresh }`, re-rendering on
every document change. Accept/reject work even in `viewing`/`readonly` mode.

## Versioning

Independent semver; see [CHANGELOG.md](./CHANGELOG.md). A runtime `VERSION`
constant is exported for diagnostics.
