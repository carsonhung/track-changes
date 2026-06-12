import { DOMParser as PMDOMParser, DOMSerializer, type Node as PMNode, type Schema } from '@tiptap/pm/model';

/**
 * HTML (de)serialization for tracked documents.
 *
 * Suggestions are document data rendered to REAL HTML by the schema specs:
 * `<ins data-suggestion data-author data-ts>` / `<del …>` for inline content
 * and `data-suggestion` / `data-suggestion-type` attributes on trackable
 * block nodes. That makes an HTML string a lossless persistence format — it
 * can live in a plain text column, is human-readable, and renders correctly
 * (including in print/PDF) without the editor.
 *
 * These helpers need a DOM `Document`. In the browser the global one is used;
 * headless callers (tests, SSR) pass their own via `options.document`.
 */

export interface HtmlCodecOptions {
  /** DOM document used for (de)serialization. Defaults to `globalThis.document`. */
  document?: Document;
}

function resolveDocument(options?: HtmlCodecOptions): Document {
  const doc = options?.document ?? (typeof document !== 'undefined' ? document : undefined);
  if (!doc) {
    throw new Error(
      'track-changes: docToHtml/htmlToDoc need a DOM Document. Pass one via options.document in non-browser environments.',
    );
  }
  return doc;
}

/** Serialize a (tracked or clean) ProseMirror document to an HTML string. */
export function docToHtml(doc: PMNode, options?: HtmlCodecOptions): string {
  const dom = resolveDocument(options);
  const serializer = DOMSerializer.fromSchema(doc.type.schema);
  const fragment = serializer.serializeFragment(doc.content, { document: dom });
  const container = dom.createElement('div');
  container.appendChild(fragment);
  return container.innerHTML;
}

/** Parse an HTML string back into a ProseMirror document for `schema`. */
export function htmlToDoc(html: string, schema: Schema, options?: HtmlCodecOptions): PMNode {
  const dom = resolveDocument(options);
  const container = dom.createElement('div');
  container.innerHTML = html;
  return PMDOMParser.fromSchema(schema).parse(container);
}

/**
 * Cheap content sniff for stored values: does this HTML string carry any
 * suggestion markup? Useful for "N pending changes" badges without parsing
 * (`data-suggestion` is emitted by both the inline marks and the node
 * attribute encoding).
 */
export function htmlHasSuggestions(html: string): boolean {
  return html.includes('data-suggestion');
}
