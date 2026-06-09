import { describe, it, expect } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createBasicSuggestionSchema } from './schema';
import { toClean, toRejected, listSuggestions, hasSuggestions } from './clean';
import { INSERTION, DELETION } from './marks';

const schema = createBasicSuggestionSchema();

interface Seg {
  text: string;
  mark?: 'insertion' | 'deletion';
  id?: string;
}

/** Build a single-paragraph doc from text segments, some carrying a suggestion mark. */
function doc(...segs: Seg[]): PMNode {
  const nodes = segs.map((s) => {
    if (!s.mark) return schema.text(s.text);
    const type = s.mark === 'insertion' ? schema.marks[INSERTION] : schema.marks[DELETION];
    return schema.text(s.text, [type.create({ id: s.id ?? `${s.mark}-1`, authorId: 'A', ts: 1 })]);
  });
  return schema.node('doc', null, [schema.node('paragraph', null, nodes)]);
}

function textOf(node: PMNode): string {
  return node.textBetween(0, node.content.size, '');
}

describe('toClean (accept-all projection)', () => {
  it('keeps inserted text and removes its mark', () => {
    const d = doc({ text: 'Hello ' }, { text: 'world', mark: 'insertion' });
    const clean = toClean(d);
    expect(textOf(clean)).toBe('Hello world');
    expect(hasSuggestions(clean)).toBe(false);
  });

  it('drops deleted text', () => {
    const d = doc({ text: 'Hello ' }, { text: 'cruel ', mark: 'deletion' }, { text: 'world' });
    expect(textOf(toClean(d))).toBe('Hello world');
  });

  it('handles mixed insertion + deletion', () => {
    const d = doc(
      { text: 'The ' },
      { text: 'quick ', mark: 'deletion' },
      { text: 'slow ', mark: 'insertion' },
      { text: 'fox' },
    );
    expect(textOf(toClean(d))).toBe('The slow fox');
    expect(hasSuggestions(toClean(d))).toBe(false);
  });
});

describe('toRejected (reject-all projection)', () => {
  it('removes inserted text and restores deleted text', () => {
    const d = doc(
      { text: 'The ' },
      { text: 'quick ', mark: 'deletion' },
      { text: 'slow ', mark: 'insertion' },
      { text: 'fox' },
    );
    expect(textOf(toRejected(d))).toBe('The quick fox');
    expect(hasSuggestions(toRejected(d))).toBe(false);
  });
});

describe('listSuggestions', () => {
  it('summarises suggestions in document order', () => {
    const d = doc(
      { text: 'a' },
      { text: 'XX', mark: 'insertion', id: 'ins-1' },
      { text: 'b' },
      { text: 'YY', mark: 'deletion', id: 'del-1' },
    );
    const list = listSuggestions(d);
    expect(list.map((s) => `${s.type}:${s.text}`)).toEqual(['insertion:XX', 'deletion:YY']);
    expect(list[0].id).toBe('ins-1');
    expect(list[1].id).toBe('del-1');
  });

  it('reports none for a clean doc', () => {
    expect(listSuggestions(doc({ text: 'plain' }))).toHaveLength(0);
    expect(hasSuggestions(doc({ text: 'plain' }))).toBe(false);
  });
});

describe('round-trip invariant', () => {
  it('toClean is stable through JSON serialize/deserialize', () => {
    const d = doc({ text: 'keep ' }, { text: 'drop ', mark: 'deletion' }, { text: 'add', mark: 'insertion' });
    const clean = toClean(d);
    const round = schema.nodeFromJSON(clean.toJSON());
    expect(textOf(round)).toBe(textOf(clean));
    expect(toClean(round).toJSON()).toEqual(clean.toJSON());
  });
});
