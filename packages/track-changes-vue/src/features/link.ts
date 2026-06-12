import { Mark, mergeAttributes } from '@tiptap/core';
import type { Editor } from '@tiptap/vue-3';
import type { EditorFeature } from './types';

/**
 * Link feature (CKEditor `Link`-equivalent, dependency-free):
 *
 * - registers a minimal `link` mark (`<a href>` with an enforced
 *   `rel="noopener noreferrer nofollow"`); no autolink, no click-to-open —
 *   report narratives need referenceable URLs, not a browsing surface
 * - "Set link" prompts for a URL (host-overridable via `promptUrl`) and marks
 *   the selection; "Remove link" unsets it
 * - **tracked automatically**: in suggesting mode the core rewrite plugin
 *   converts the link mark's Add/RemoveMarkStep into a `format_change`
 *   suggestion like any other formatting toggle, so setting or removing a
 *   link is reviewable (accept keeps it, reject restores the prior state)
 * - schema-gated like every feature: without this feature the `link` mark
 *   does not exist, so pasted links lose their hyperlink on parse
 */

const URL_SCHEME = /^(https?:|mailto:)/i;

/** Normalize user input to a safe absolute URL, or null to abort. */
export function normalizeLinkHref(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  if (URL_SCHEME.test(value)) return value;
  // Reject anything that *has* a scheme but not an allowed one (javascript:,
  // data:, file:, vbscript:, …) instead of prefixing it into a hostname.
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
  return `https://${value}`;
}

export const TrackedLink = Mark.create({
  name: 'link',
  // Typing at the edge of a link should not extend it.
  inclusive: false,
  addAttributes() {
    return {
      href: {
        default: null,
        parseHTML: (el) => el.getAttribute('href'),
      },
      title: {
        default: null,
        parseHTML: (el) => el.getAttribute('title'),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'a[href]',
        getAttrs: (el) => {
          const href = (el as HTMLElement).getAttribute('href') ?? '';
          // Schema-level guard: pasted javascript:/data: links never parse.
          return URL_SCHEME.test(href) ? null : false;
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'a',
      mergeAttributes(HTMLAttributes, { rel: 'noopener noreferrer nofollow' }),
      0,
    ];
  },
});

export interface LinkFeatureLabels {
  setLink: string;
  removeLink: string;
  /** Prompt message shown by the default `window.prompt` URL input. */
  promptMessage: string;
}

export interface LinkFeatureOptions {
  /** Override button labels (i18n). */
  labels?: Partial<LinkFeatureLabels>;
  /**
   * URL input UI. Receives the selection's current href (when editing an
   * existing link) and resolves with the raw user input, or null to cancel.
   * Defaults to `window.prompt`; hosts can swap in a proper dialog.
   */
  promptUrl?: (current: string | null, message: string) => Promise<string | null>;
}

function currentHref(editor: Editor): string | null {
  const attrs = editor.getAttributes('link');
  return typeof attrs.href === 'string' ? attrs.href : null;
}

export function createLinkFeature(options: LinkFeatureOptions = {}): EditorFeature {
  const labels: LinkFeatureLabels = {
    setLink: 'Set link',
    removeLink: 'Remove link',
    promptMessage: 'Link URL',
    ...options.labels,
  };
  const promptUrl =
    options.promptUrl ??
    (async (current: string | null, message: string) =>
      window.prompt(message, current ?? 'https://') ?? null);

  return {
    name: 'link',
    extensions: () => [TrackedLink],
    toolbarItems: () => [
      {
        id: 'link:set',
        label: labels.setLink,
        text: labels.setLink,
        // Needs a non-empty selection to attach the mark to.
        isEnabled: ({ editor }) => !editor.state.selection.empty,
        isActive: ({ editor }) => editor.isActive('link'),
        run: async ({ editor }) => {
          const raw = await promptUrl(currentHref(editor), labels.promptMessage);
          if (raw === null) return;
          const href = normalizeLinkHref(raw);
          if (!href) return;
          // Plain setMark — in suggesting mode the rewrite plugin converts
          // the AddMarkStep into a tracked format_change suggestion.
          editor.chain().focus().setMark('link', { href }).run();
        },
      },
      {
        id: 'link:remove',
        label: labels.removeLink,
        text: labels.removeLink,
        isEnabled: ({ editor }) => editor.isActive('link'),
        run: ({ editor }) => {
          editor.chain().focus().extendMarkRange('link').unsetMark('link').run();
        },
      },
    ],
  };
}
