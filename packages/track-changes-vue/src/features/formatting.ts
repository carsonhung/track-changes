import type { Editor } from '@tiptap/vue-3';
import type { EditorFeature, EditorToolbarItem } from './types';

/**
 * Formatting feature (CKEditor `Bold`/`Italic`/… equivalents, P2f). All the
 * underlying marks/nodes ship with StarterKit, so this feature contributes no
 * extensions — only toolbar items.
 *
 * Track-changes integration is free by design: the buttons dispatch plain
 * Tiptap toggle commands, whose `AddMarkStep` / `RemoveMarkStep` transactions
 * are untagged — in suggesting mode the core rewrite plugin converts them into
 * `format_change` suggestions (apply the formatting for real + record the
 * toggle for accept/reject). Keyboard shortcuts (Ctrl+B/I) take the exact same
 * path, so toolbar and keyboard formatting are tracked identically.
 *
 * Inline marks (bold / italic / strike) are tracked; block-type changes
 * (headings, lists) are structural and pass through untracked — documented
 * limitation of the mark model.
 */

export interface FormattingFeatureLabels {
  bold: string;
  italic: string;
  strike: string;
  heading2: string;
  heading3: string;
  bulletList: string;
  orderedList: string;
}

export interface FormattingFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<FormattingFeatureLabels>;
  /**
   * Which buttons to render, in order. Defaults to all.
   * Codes: `bold` | `italic` | `strike` | `heading2` | `heading3` |
   * `bulletList` | `orderedList`.
   */
  buttons?: Array<keyof FormattingFeatureLabels>;
}

const DEFAULT_LABELS: FormattingFeatureLabels = {
  bold: 'Bold',
  italic: 'Italic',
  strike: 'Strikethrough',
  heading2: 'Heading',
  heading3: 'Subheading',
  bulletList: 'Bullet list',
  orderedList: 'Numbered list',
};

const DEFAULT_BUTTONS: Array<keyof FormattingFeatureLabels> = [
  'bold',
  'italic',
  'strike',
  'heading2',
  'heading3',
  'bulletList',
  'orderedList',
];

interface ButtonDef {
  text: string;
  isActive: (editor: Editor) => boolean;
  run: (editor: Editor) => void;
}

const BUTTONS: Record<keyof FormattingFeatureLabels, ButtonDef> = {
  bold: {
    text: 'B',
    isActive: (ed) => ed.isActive('bold'),
    run: (ed) => ed.chain().focus().toggleBold().run(),
  },
  italic: {
    text: 'I',
    isActive: (ed) => ed.isActive('italic'),
    run: (ed) => ed.chain().focus().toggleItalic().run(),
  },
  strike: {
    text: 'S',
    isActive: (ed) => ed.isActive('strike'),
    run: (ed) => ed.chain().focus().toggleStrike().run(),
  },
  heading2: {
    text: 'H2',
    isActive: (ed) => ed.isActive('heading', { level: 2 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 2 }).run(),
  },
  heading3: {
    text: 'H3',
    isActive: (ed) => ed.isActive('heading', { level: 3 }),
    run: (ed) => ed.chain().focus().toggleHeading({ level: 3 }).run(),
  },
  bulletList: {
    text: '\u2022',
    isActive: (ed) => ed.isActive('bulletList'),
    run: (ed) => ed.chain().focus().toggleBulletList().run(),
  },
  orderedList: {
    text: '1.',
    isActive: (ed) => ed.isActive('orderedList'),
    run: (ed) => ed.chain().focus().toggleOrderedList().run(),
  },
};

export function createFormattingFeature(options: FormattingFeatureOptions = {}): EditorFeature {
  const labels: FormattingFeatureLabels = { ...DEFAULT_LABELS, ...options.labels };
  const buttons = options.buttons ?? DEFAULT_BUTTONS;

  return {
    name: 'formatting',
    toolbarItems: () =>
      buttons.map((code): EditorToolbarItem => {
        const def = BUTTONS[code];
        return {
          id: `formatting.${code}`,
          label: labels[code],
          text: def.text,
          isActive: ({ editor }) => def.isActive(editor),
          isEnabled: ({ editor }) => editor.isEditable,
          run: ({ editor }) => def.run(editor),
        };
      }),
  };
}
