import { describe, it, expect, afterEach, vi } from 'vitest';
import { Slice } from '@tiptap/pm/model';
import {
  createImageUploadFeature,
  isLikelyImageLink,
  type EditorUploadHandler,
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

interface MountOptions {
  mode?: 'editing' | 'suggesting';
  content?: string;
  uploadHandler?: EditorUploadHandler | null;
}

function mount(feature: ImageUploadFeatureOptions, opts: MountOptions = {}) {
  const target = document.createElement('div');
  document.body.appendChild(target);
  handle = createTrackChangesEditor(target, {
    content: opts.content ?? '<p>See:</p>',
    mode: opts.mode ?? 'suggesting',
    authorId: 'u1',
    uploadHandler: opts.uploadHandler ?? null,
    features: [createImageUploadFeature(feature)],
  });
  handle.editor.commands.setTextSelection(handle.editor.state.doc.content.size - 1);
  return handle;
}

/** Run the editor's paste handlers as a real paste would. */
function paste(
  h: TrackChangesEditorHandle,
  clip: { text?: string; html?: string; files?: File[] },
): boolean {
  const { view } = h.editor;
  const event = {
    clipboardData: {
      getData: (type: string) =>
        type === 'text/plain' ? (clip.text ?? '') : type === 'text/html' ? (clip.html ?? '') : '',
      files: clip.files ?? [],
    },
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

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png' });

describe('pasted image links', () => {
  it('copies a pasted image link into storage and inserts it as a tracked image', async () => {
    const events: ImagePasteEvent[] = [];
    const pending = deferred<{ src: string }>();
    const ingestUrl = vi.fn(() => pending.promise);
    const h = mount({ ingestUrl, onImagePaste: (e) => events.push(e) });

    expect(paste(h, { text: 'https://example.com/photo.png' })).toBe(true);
    expect(ingestUrl).toHaveBeenCalledWith('https://example.com/photo.png');
    expect(h.element.querySelector('.tc-img-pending')?.textContent).toBe('Importing image\u2026');

    pending.resolve({ src: '/files/photo.png' });
    await flush();

    expect(h.element.querySelector('.tc-img-pending')).toBeNull();
    expect(h.getHTML()).toContain('src="/files/photo.png"');
    expect(h.listSuggestions()[0]).toMatchObject({
      type: 'insertion',
      nodeType: 'image',
      authorId: 'u1',
    });
    expect(events).toEqual([
      { status: 'ingested', url: 'https://example.com/photo.png', source: 'link' },
    ]);
  });

  it('keeps the image where the user pasted even if they typed meanwhile', async () => {
    const pending = deferred<{ src: string }>();
    const h = mount({ ingestUrl: () => pending.promise }, { mode: 'editing' });
    paste(h, { text: 'https://drive.google.com/file/d/abc/view' });
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
    paste(h, { text: 'https://1drv.ms/i/s!abc' });
    await flush();

    expect(h.element.querySelector('.tc-img-pending')).toBeNull();
    expect(h.getCleanHtml()).toBe('<p>See:https://1drv.ms/i/s!abc</p>');
    expect(h.listSuggestions()[0]).toMatchObject({ type: 'insertion', text: 'https://1drv.ms/i/s!abc' });
    expect(events[0]).toMatchObject({ status: 'rejected', source: 'link' });
  });

  it('inserts a link that already points at our own storage without copying it', () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/x.png' }));
    const h = mount(
      { ingestUrl, localImageOrigins: ['https://bucket.example.com'] },
      { mode: 'editing' },
    );
    expect(paste(h, { text: 'https://bucket.example.com/k/a.png' })).toBe(true);
    expect(ingestUrl).not.toHaveBeenCalled();
    expect(h.getHTML()).toContain('src="https://bucket.example.com/k/a.png"');
  });

  it('leaves ordinary links, multi-word text, and image markup to the normal paste', () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/x.png' }));
    const h = mount({ ingestUrl });
    expect(paste(h, { text: 'https://example.com/article' })).toBe(true); // suggesting clipboard plugin
    expect(paste(h, { text: 'look at https://example.com/a.png' })).toBe(true);
    expect(
      paste(h, {
        text: 'https://example.com/a.png',
        html: '<img src="https://example.com/a.png">',
      }),
    ).toBe(true);
    // Only the localizer touches the pasted <img> (asynchronously); the
    // link-paste path itself never ran.
    expect(h.element.querySelector('.tc-img-pending')).toBeNull();
  });

  it('is disabled by pasteImageLinks: false or without ingestUrl', () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/x.png' }));
    let h = mount({ ingestUrl, pasteImageLinks: false }, { mode: 'editing' });
    expect(paste(h, { text: 'https://example.com/a.png' })).toBe(false);
    h.destroy();
    h = mount({}, { mode: 'editing' });
    expect(paste(h, { text: 'https://example.com/a.png' })).toBe(false);
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('honors a custom predicate', () => {
    const ingestUrl = vi.fn(() => new Promise<{ src: string }>(() => {}));
    const h = mount(
      { ingestUrl, pasteImageLinks: (url) => url.includes('cdn.example') },
      { mode: 'editing' },
    );
    expect(paste(h, { text: 'https://example.com/a.png' })).toBe(false);
    expect(paste(h, { text: 'https://cdn.example/x' })).toBe(true);
    expect(ingestUrl).toHaveBeenCalledTimes(1);
  });
});

describe('pasted image files', () => {
  it('uploads pasted files through the editor uploadHandler, in order', async () => {
    const events: ImagePasteEvent[] = [];
    const uploadHandler = vi.fn(async (file: File) => ({ src: `/files/${file.name}` }));
    const h = mount({ onImagePaste: (e) => events.push(e) }, { uploadHandler });

    expect(paste(h, { files: [png('one.png'), png('two.png')] })).toBe(true);
    expect(h.element.querySelector('.tc-img-pending')).not.toBeNull();
    await flush();

    expect(uploadHandler).toHaveBeenCalledTimes(2);
    expect(h.getCleanHtml()).toBe(
      '<p>See:<img class="tc-img" src="/files/one.png" alt="one.png">' +
        '<img class="tc-img" src="/files/two.png" alt="two.png"></p>',
    );
    expect(h.listSuggestions().every((s) => s.type === 'insertion')).toBe(true);
    expect(events.map((e) => e.status)).toEqual(['uploaded', 'uploaded']);
  });

  it('uses the handler set later via setUploadHandler', async () => {
    const h = mount({}, { mode: 'editing' });
    expect(paste(h, { files: [png('a.png')] })).toBe(false);
    h.setUploadHandler(async () => ({ src: '/files/a.png' }));
    expect(paste(h, { files: [png('a.png')] })).toBe(true);
    await flush();
    expect(h.getHTML()).toContain('src="/files/a.png"');
  });

  it('skips files whose upload fails and reports them', async () => {
    const events: ImagePasteEvent[] = [];
    const h = mount(
      { onImagePaste: (e) => events.push(e) },
      {
        mode: 'editing',
        uploadHandler: async (f) => {
          if (f.name === 'bad.png') throw new Error('too large');
          return { src: `/files/${f.name}` };
        },
      },
    );
    paste(h, { files: [png('bad.png'), png('ok.png')] });
    await flush();
    expect(h.getHTML()).toBe('<p>See:<img class="tc-img" src="/files/ok.png" alt="ok.png"></p>');
    expect(events).toEqual([
      { status: 'rejected', url: 'bad.png', source: 'file' },
      { status: 'uploaded', url: 'ok.png', source: 'file' },
    ]);
  });
});

describe('storage-owned images (bucket / CDN)', () => {
  const BUCKET = '<p>x<img src="https://bucket.example.com/k/a.png"></p>';

  it('never re-ingests or strips images on localImageOrigins', async () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/copy.png' }));
    const h = mount(
      { ingestUrl, localImageOrigins: ['https://bucket.example.com'] },
      { content: BUCKET, mode: 'editing' },
    );
    await flush();
    expect(ingestUrl).not.toHaveBeenCalled();
    expect(h.getHTML()).toContain('src="https://bucket.example.com/k/a.png"');
  });

  it('treats an unlisted https src as external (copied, original link dropped)', async () => {
    const ingestUrl = vi.fn(() => Promise.resolve({ src: '/copy.png' }));
    const h = mount({ ingestUrl }, { content: BUCKET, mode: 'editing' });
    await flush();
    expect(ingestUrl).toHaveBeenCalledWith('https://bucket.example.com/k/a.png');
    expect(h.getHTML()).toContain('src="/copy.png"');
  });

  it('rejects a storage result that is not local instead of looping', async () => {
    const events: ImagePasteEvent[] = [];
    const ingestUrl = vi.fn(() => Promise.resolve({ src: 'https://elsewhere.example/copy.png' }));
    const h = mount(
      { ingestUrl, onImagePaste: (e) => events.push(e) },
      { content: '<p>x<img src="https://example.com/a.png"></p>', mode: 'editing' },
    );
    await flush();
    await flush();
    expect(ingestUrl).toHaveBeenCalledTimes(1);
    expect(h.getHTML()).toBe('<p>x</p>');
    expect(events).toEqual([{ status: 'rejected', url: 'https://example.com/a.png', source: 'image' }]);
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
