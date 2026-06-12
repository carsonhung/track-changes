// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createExtendedSuggestionSchema } from './schema';
import { docToHtml, htmlToDoc, htmlHasSuggestions } from './html';
import { listSuggestions, toClean, toRejected } from './clean';

const schema = createExtendedSuggestionSchema();

function p(...content: PMNode[]): PMNode {
  return schema.nodes.paragraph.create(null, content);
}

function text(t: string, marks: ReturnType<typeof schema.mark>[] = []): PMNode {
  return schema.text(t, marks);
}

const ins = (id: string) => schema.mark('insertion', { id, authorId: 'alice', ts: 1700000000000 });
const del = (id: string) => schema.mark('deletion', { id, authorId: 'bob', ts: 1700000001000 });

function textOf(doc: PMNode): string {
  return doc.textBetween(0, doc.content.size, ' ');
}

describe('docToHtml', () => {
  it('renders insertion/deletion marks as real <ins>/<del> tags with data attributes', () => {
    const doc = schema.nodes.doc.create(null, [
      p(text('Hello '), text('new', [ins('s1')]), text(' world '), text('old', [del('s2')])),
    ]);
    const html = docToHtml(doc);

    expect(html).toContain('<ins data-suggestion="s1" data-author="alice" data-ts="1700000000000"');
    expect(html).toContain('<del data-suggestion="s2" data-author="bob" data-ts="1700000001000"');
    expect(htmlHasSuggestions(html)).toBe(true);
  });

  it('renders a clean doc without suggestion markup', () => {
    const doc = schema.nodes.doc.create(null, [p(text('Just text'))]);
    const html = docToHtml(doc);
    expect(html).toBe('<p>Just text</p>');
    expect(htmlHasSuggestions(html)).toBe(false);
  });
});

describe('HTML round-trip (doc → html → doc)', () => {
  it('is lossless for inline suggestion marks (id, author, ts)', () => {
    const original = schema.nodes.doc.create(null, [
      p(text('Hello '), text('new', [ins('s1')]), text(' world '), text('old', [del('s2')])),
    ]);

    const restored = htmlToDoc(docToHtml(original), schema);

    expect(textOf(restored)).toBe(textOf(original));
    const list = listSuggestions(restored);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: 's1', type: 'insertion', text: 'new', authorId: 'alice' });
    expect(list[1]).toMatchObject({ id: 's2', type: 'deletion', text: 'old', authorId: 'bob' });

    // Accept/reject semantics survive the round-trip.
    expect(textOf(toClean(restored))).toBe('Hello new world ');
    expect(textOf(toRejected(restored))).toBe('Hello  world old');
  });

  it('is lossless for the block/structural node-attribute encoding (table row)', () => {
    const cell = (t: string) => schema.nodes.tableCell.create(null, [text(t)]);
    const cleanRow = schema.nodes.tableRow.create(null, [cell('a'), cell('b')]);
    const insertedRow = schema.nodes.tableRow.create(
      { suggestion: { type: 'insertion', id: 'r1', authorId: 'alice', ts: 1700000000000 } },
      [cell('c'), cell('d')],
    );
    const original = schema.nodes.doc.create(null, [
      schema.nodes.table.create(null, [cleanRow, insertedRow]),
    ]);

    const html = docToHtml(original);
    expect(html).toContain('data-suggestion-type="insertion"');

    const restored = htmlToDoc(html, schema);
    const restoredTable = restored.child(0);
    expect(restoredTable.childCount).toBe(2);
    expect(restoredTable.child(0).attrs.suggestion).toBeNull();
    expect(restoredTable.child(1).attrs.suggestion).toMatchObject({
      type: 'insertion',
      id: 'r1',
      authorId: 'alice',
    });

    const list = listSuggestions(restored);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'r1', type: 'insertion' });
  });

  it('round-trips repeatedly without drift (html → doc → html is stable)', () => {
    const original = schema.nodes.doc.create(null, [
      p(text('Stable '), text('ins', [ins('s1')])),
    ]);
    const html1 = docToHtml(original);
    const html2 = docToHtml(htmlToDoc(html1, schema));
    expect(html2).toBe(html1);
  });
});

describe('htmlToDoc', () => {
  it('parses plain HTML written outside the editor', () => {
    const doc = htmlToDoc('<p>One</p><p>Two</p>', schema);
    expect(doc.childCount).toBe(2);
    expect(textOf(doc)).toBe('One Two');
    expect(listSuggestions(doc)).toHaveLength(0);
  });

  it('falls back to the global document when options.document is not provided', () => {
    expect(() => htmlToDoc('<p>x</p>', schema, {})).not.toThrow();
  });
});
