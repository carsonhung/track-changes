import { describe, it, expect, afterEach, vi } from 'vitest';
import { Slice } from '@tiptap/pm/model';
import {
  createImageUploadFeature,
  isLikelyImageLink,
  type ImagePasteEvent,
  type ImageUploadFeatureOptions,
} from 'track-changes-core';
import { createTrackChangesEditor, type TrackChangesEditorHandle } from './createTrackChangesEditor';

let handle: TrackChangesEditorHandle | null = null;

afterEach(() => {
  handle?.destroy();
  handle = null;
  document.body.innerHTML = '';
});

function mount(feature: ImageUploadFeatureOptions, mode: 'editing' | 'suggesting' = 'suggesting') {
  const target = document.createElement('div');
  document.body.appendChild(target);
  handle = createTrackChangesEditor(target, {
    content: '<p>See:</p>',
    mode,
    authorId: 'u1',
    features: [createImageUploadFeature(feature)],
  });
  const { view } = handle.editor;
  const end = view.state.doc.content.size - 1;
  handle.editor.commands.setTextSelection(end);
  return handle;
}

/** Run the editor's paste handlers as a real paste of `text` would. */
function paste(h: TrackChangesEditorHandle, text: string, html = ''): boolean {
  const { view } = h.editor;
  const event = {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : html) },
  } as unknown as ClipboardEvent;
  return Boolean(view.someProp('handlePaste', (f) => f(view, event, Slice.empty)));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('image-link paste', () => {
  it('imports a pasted image link and inserts it as a tracked image', async () => {
    const events: ImagePasteEvent[] = [];
    const pending = deferred<{ src: string }>();
    const ingestUrl = vi.fn(() => pending.promise);
    const h = mount({ ingestUrl, onImagePaste: (e) => events.push(e) });

    expect(paste(h, 'https://example.com/photo.png')).toBe(true);
    expect(ingestUrl).toHaveBeenCalledWith('https://example.com/photo.png');
    expect(h.element.querySelector('.tc-img-pending')?.textContent).toBe('Importing image\u2026');

    pending.resolve({ src: '/files/photo.png' });
    await flush();

    expect(h.element.querySelector('.tc-img-pending')).toBeNull();
    expect(h.getHTML()).toContain('src="/files/photo.png"');
    const [suggestion] = h.listSuggestions();
    expect(suggestion).toMatchObject({ type: 'insertion', nodeType: 'image', authorId: 'u1' });
    expect(events).toEqual([
      { status: 'ingested', url: 'https://example.com/photo.png', source: 'link' },
    ]);
  });

  it('keeps the image where the user pasted even if they typed meanwhile', async () => {
    const pending = deferred<{ src: string }>();
    const h = mount({ ingestUrl: () => pending.promise }, 'editing');
    paste(h, 'https://drive.google.com/file/d/abc/view');
    h.editor.commands.insertContentAt(1, 'Please ');

    pending.resolve({ src: '/files/abc.png' });
    await flush();
    expect(h.getHTML()).toBe('<p>Please See:<img class="tc-img" src="/files/abc.png" alt=""></p>');
  });

  it('falls back to pasting the URL as text when ingestion fails', async () => {
    const events: ImagePasteEvent[] = [];
    const h = mount({
      ingestUrl: () => Promise.reject(new Error('not an image')),
      onImagePaste: (e) => events.push(e),
    });
    paste(h, 'https://1drv.ms/i/s!abc');
    await flush();

    expect(h.element.querySelector('.tc-img-pending')).toBeNull();
    expect(h.getCleanHtml()).toBe('<p>See:https://1drv.ms/i/s!abc</p>');
    expect(h.listSuggestions()[0]).toMatchObject({ type: 'insertion', text: 'https://1drv.ms/i/s!abc' });
    expect(events[0]).toMatchObject({ status: 'rejected', source: 'link' });
  });

  it('leaves ordinary links, multi-word text, and image markup to the normal paste', () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/x.png' }));
    const h = mount({ ingestUrl });
    expect(paste(h, 'https://example.com/article')).toBe(true); // suggesting clipboard plugin
    expect(paste(h, 'look at https://example.com/a.png')).toBe(true);
    expect(paste(h, 'https://example.com/a.png', '<img src="https://example.com/a.png">')).toBe(true);
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('is disabled by pasteImageLinks: false or without ingestUrl', () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/x.png' }));
    let h = mount({ ingestUrl, pasteImageLinks: false }, 'editing');
    expect(paste(h, 'https://example.com/a.png')).toBe(false);
    h.destroy();
    h = mount({}, 'editing');
    expect(paste(h, 'https://example.com/a.png')).toBe(false);
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('honors a custom predicate', () => {
    const ingestUrl = vi.fn(() => new Promise<{ src: string }>(() => {}));
    const h = mount({ ingestUrl, pasteImageLinks: (url) => url.includes('cdn.example') }, 'editing');
    expect(paste(h, 'https://example.com/a.png')).toBe(false);
    expect(paste(h, 'https://cdn.example/x')).toBe(true);
    expect(ingestUrl).toHaveBeenCalledTimes(1);
  });
});

describe('isLikelyImageLink', () => {
  it.each([
    ['https://example.com/a/photo.JPG', true],
    ['https://example.com/a.webp?w=200', true],
    ['https://drive.google.com/file/d/abc/view?usp=sharing', true],
    ['https://lh3.googleusercontent.com/abc', true],
    ['https://www.dropbox.com/s/abc/x?dl=0', true],
    ['https://contoso.sharepoint.com/:i:/g/abc', true],
    ['https://example.com/article', false],
    ['https://docs.google.com/document/d/abc', false],
    ['ftp://example.com/a.png', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(isLikelyImageLink(url)).toBe(expected);
  });
});
