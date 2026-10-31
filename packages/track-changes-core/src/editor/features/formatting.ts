import type { Editor } from '@tiptap/core';
import type { EditorFeature, EditorToolbarItem } from './types';

/**
 * Formatting feature (CKEditor `Bold`/`Italic`/… equivalents, P2f). All the
 * underlying marks/nodes ship with StarterKit; this feature contributes
 * toolbar items plus the `starterKitOptions` that re-enable exactly those
 * pieces (the editor disables every formatting-related StarterKit piece by
 * default, so fields WITHOUT this feature truly cannot be formatted — no
 * shortcut, no markdown input rule, pasted markup stripped).
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

// Generic core commands (what StarterKit's toggleBold/toggleHeading/… wrap),
// so this module needs no StarterKit typings.
const BUTTONS: Record<keyof FormattingFeatureLabels, ButtonDef> = {
  bold: {
    text: 'B',
    isActive: (ed) => ed.isActive('bold'),
    run: (ed) => ed.chain().focus().toggleMark('bold').run(),
  },
  italic: {
    text: 'I',
    isActive: (ed) => ed.isActive('italic'),
    run: (ed) => ed.chain().focus().toggleMark('italic').run(),
  },
  strike: {
    text: 'S',
    isActive: (ed) => ed.isActive('strike'),
    run: (ed) => ed.chain().focus().toggleMark('strike').run(),
  },
  heading2: {
    text: 'H2',
    isActive: (ed) => ed.isActive('heading', { level: 2 }),
    run: (ed) => ed.chain().focus().toggleNode('heading', 'paragraph', { level: 2 }).run(),
  },
  heading3: {
    text: 'H3',
    isActive: (ed) => ed.isActive('heading', { level: 3 }),
    run: (ed) => ed.chain().focus().toggleNode('heading', 'paragraph', { level: 3 }).run(),
  },
  bulletList: {
    text: '\u2022',
    isActive: (ed) => ed.isActive('bulletList'),
    run: (ed) => ed.chain().focus().toggleList('bulletList', 'listItem').run(),
  },
  orderedList: {
    text: '1.',
    isActive: (ed) => ed.isActive('orderedList'),
    run: (ed) => ed.chain().focus().toggleList('orderedList', 'listItem').run(),
  },
};

export function createFormattingFeature(options: FormattingFeatureOptions = {}): EditorFeature {
  const labels: FormattingFeatureLabels = { ...DEFAULT_LABELS, ...options.labels };
  const buttons = options.buttons ?? DEFAULT_BUTTONS;

  // Re-enable exactly the StarterKit pieces the rendered buttons need (the
  // editor disables all formatting by default — see RESTRICTED_STARTER_KIT).
  // What you see in the toolbar is therefore exactly what the field allows,
  // shortcuts and paste included.
  const starterKitOptions = (): Record<string, unknown> => {
    const opts: Record<string, unknown> = {};
    if (buttons.includes('bold')) opts.bold = {};
    if (buttons.includes('italic')) opts.italic = {};
    if (buttons.includes('strike')) opts.strike = {};
    const levels = [
      ...(buttons.includes('heading2') ? [2] : []),
      ...(buttons.includes('heading3') ? [3] : []),
    ];
    if (levels.length) opts.heading = { levels };
    if (buttons.includes('bulletList') || buttons.includes('orderedList')) opts.listItem = {};
    if (buttons.includes('bulletList')) opts.bulletList = {};
    if (buttons.includes('orderedList')) opts.orderedList = {};
    return opts;
  };

  return {
    name: 'formatting',
    starterKitOptions,
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
