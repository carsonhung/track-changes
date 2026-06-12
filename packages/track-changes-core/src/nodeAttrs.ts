import type { Node as PMNode } from '@tiptap/pm/model';
import type { SuggestionType } from './marks';

/**
 * Block / structural-node suggestion encoding.
 *
 * Inline content (text and inline atoms like images) carries suggestions as the
 * `insertion` / `deletion` **marks** in `marks.ts`. But block and structural
 * nodes — a block image (`figure`), a `tableRow` — cannot meaningfully carry an
 * inline mark, so their tracked state lives in a single node **attribute**
 * named `suggestion`.
 *
 * Both encodings are document data (they serialize into the ProseMirror JSON and
 * render to `data-*` attributes for print/PDF), upholding the keystone rule. The
 * accept/reject engine in `clean.ts` resolves both the same way.
 */

/** Attribute name carried by trackable block/structural nodes. Stable: persisted. */
export const SUGGESTION_NODE_ATTR = 'suggestion';

/** Value of the `suggestion` node attribute (or `null` when the node is clean). */
export interface NodeSuggestion {
  type: SuggestionType;
  id: string;
  authorId: string | null;
  ts: number | null;
}

/** Attribute-spec fragment to spread into a trackable node's `attrs`. */
export function suggestionNodeAttrSpec(): Record<string, { default: null }> {
  return { [SUGGESTION_NODE_ATTR]: { default: null } };
}

/** Whether a node type declares the `suggestion` attribute (i.e. is trackable). */
export function isTrackableNode(node: PMNode): boolean {
  return Boolean(node.type.spec.attrs && SUGGESTION_NODE_ATTR in node.type.spec.attrs);
}

/** Read & validate the `suggestion` attribute off a node, or `null` if absent/invalid. */
export function readNodeSuggestion(node: PMNode): NodeSuggestion | null {
  const raw = (node.attrs as Record<string, unknown> | undefined)?.[SUGGESTION_NODE_ATTR] as
    | Partial<NodeSuggestion>
    | null
    | undefined;
  if (!raw || (raw.type !== 'insertion' && raw.type !== 'deletion') || !raw.id) return null;
  const ts = typeof raw.ts === 'number' && Number.isFinite(raw.ts) ? raw.ts : null;
  return { type: raw.type, id: String(raw.id), authorId: raw.authorId ?? null, ts };
}

/** Serialize a suggestion to `data-*` DOM attributes (toDOM / Tiptap renderHTML). */
export function suggestionToDomAttrs(s: NodeSuggestion | null): Record<string, string> {
  if (!s) return {};
  return {
    'data-suggestion': s.id,
    'data-suggestion-type': s.type,
    'data-author': s.authorId ?? '',
    'data-ts': String(s.ts ?? ''),
    class: s.type === 'insertion' ? 'tc-node-ins' : 'tc-node-del',
  };
}

/** Parse a suggestion from `data-*` DOM attributes (parseDOM / Tiptap parseHTML). */
export function suggestionFromDom(el: HTMLElement): NodeSuggestion | null {
  const id = el.getAttribute('data-suggestion');
  const type = el.getAttribute('data-suggestion-type');
  if (!id || (type !== 'insertion' && type !== 'deletion')) return null;
  const ts = Number(el.getAttribute('data-ts'));
  return {
    id,
    type,
    authorId: el.getAttribute('data-author') || null,
    ts: Number.isFinite(ts) && ts > 0 ? ts : null,
  };
}
