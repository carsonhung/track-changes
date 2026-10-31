import type { Editor } from '@tiptap/core';
import {
  createEditorCommands,
  createSuggestionReview,
  createFormattingFeature,
  createLinkFeature,
  createTableFeature,
  createImageUploadFeature,
  type EditorMode,
  type SuggestionSummary,
} from 'track-changes-core';
import type { EditorHost, Framework, HostOptions } from './hosts/types';
import { FRAMEWORKS } from './snippets';
import 'track-changes-styles/track-changes.css';
import './demo.css';

const AUTHORS: Record<string, { name: string; color: string }> = {
  alice: { name: 'Alice', color: '#16a34a' },
  bob: { name: 'Bob', color: '#2563eb' },
};

const ICON_CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
const ICON_X = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const now = Date.now();
const ts = (minutesAgo: number) => now - minutesAgo * 60_000;

const INITIAL = `
<h2>Quarterly project report</h2>
<p>The project <del data-suggestion="s1" data-author="bob" data-ts="${ts(42)}">will finish</del><ins data-suggestion="s2" data-author="bob" data-ts="${ts(42)}">finished</ins> phase one <ins data-suggestion="s3" data-author="alice" data-ts="${ts(18)}">on time and </ins>under budget.</p>
<p>Next quarter we will focus on <span data-suggestion="s4" data-suggestion-format="add:bold" data-author="alice" data-ts="${ts(7)}"><strong>user research</strong></span> and accessibility.</p>
<table><tbody>
<tr><th>Milestone</th><th>Status</th></tr>
<tr><td>Design review</td><td>Done</td></tr>
<tr><td>Pilot launch</td><td>In progress</td></tr>
</tbody></table>
`;

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let toastTimer: number | undefined;
function toast(message: string) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('toast--show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('toast--show'), 3200);
}

// The demo has no backend, so "your storage" is a data: URL. A real app
// uploads to its bucket here and copies remote images server-side.
const features = [
  createFormattingFeature(),
  createLinkFeature(),
  createTableFeature(),
  createImageUploadFeature({
    ingestUrl: async (url) => {
      const res = await fetch(url);
      const blob = await res.blob();
      if (!res.ok || !blob.type.startsWith('image/')) throw new Error('not an image');
      return { src: await readAsDataUrl(blob) };
    },
    onImagePaste: (e) => {
      if (e.status === 'uploaded' || e.status === 'ingested') toast('Image copied into storage');
      else if (e.source === 'link') toast('That link could not be imported in the browser, so it was pasted as text');
      else toast('That image could not be imported');
    },
  }),
];
const uploadHandler = async (file: File) => ({ src: await readAsDataUrl(file), alt: file.name });

// --- Editor (whichever framework is mounted) ---------------------------------

let editor: Editor | null = null;
let host: EditorHost | null = null;
let mode: EditorMode = 'suggesting';
let authorId = 'alice';

const commands = createEditorCommands(() => editor);
const review = createSuggestionReview((list) => renderSuggestions(list));

const HOSTS: Record<Framework, () => Promise<{ mount: (el: HTMLElement, o: HostOptions) => EditorHost }>> = {
  vanilla: () => import('./hosts/vanilla'),
  vue: () => import('./hosts/vue'),
  react: () => import('./hosts/react'),
};

let mountToken = 0;

async function mountFramework(fw: Framework) {
  const token = ++mountToken;
  const content = commands.getHTML() ?? INITIAL;
  const { mount } = await HOSTS[fw]();
  if (token !== mountToken) return;

  host?.destroy();
  editor = null;
  const el = $('#editor');
  el.replaceChildren();
  host = mount(el, {
    content,
    mode,
    authorId,
    features,
    uploadHandler,
    maxWords: 150,
    onReady: (ed) => {
      editor = ed;
      review.bind(ed);
      renderOutput();
    },
    onChange: () => renderOutput(),
  });
}

// --- Framework switcher ------------------------------------------------------

function isFramework(v: string): v is Framework {
  return v in FRAMEWORKS;
}

function selectFramework(fw: Framework) {
  const info = FRAMEWORKS[fw];
  document.querySelectorAll<HTMLButtonElement>('[data-framework]').forEach((btn) => {
    btn.setAttribute('aria-selected', String(btn.dataset.framework === fw));
  });
  $('#install-cmd').textContent = `npm i ${info.pkg}`;
  $('#running-pkg').textContent = info.pkg;
  $('#code-file').textContent = info.file;
  $('#code').textContent = info.code;
  history.replaceState(null, '', fw === 'vanilla' ? location.pathname : `#${fw}`);
  void mountFramework(fw);
}

document.querySelectorAll<HTMLButtonElement>('[data-framework]').forEach((btn) => {
  btn.addEventListener('click', () => selectFramework(btn.dataset.framework as Framework));
});

// --- Mode + author -----------------------------------------------------------

const MODE_HINTS: Record<EditorMode, string> = {
  suggesting: 'Every edit is recorded as a suggestion with your name on it.',
  editing: 'Edits apply directly, like a document owner fixing typos.',
  viewing: 'Read-only. You can still accept or reject suggestions.',
};

function setMode(next: EditorMode) {
  mode = next;
  host?.setMode(next);
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
    btn.setAttribute('aria-checked', String(btn.dataset.mode === next));
  });
  $('#mode-hint').textContent = MODE_HINTS[next];
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((btn) => {
  btn.addEventListener('click', () => setMode(btn.dataset.mode as EditorMode));
});

$<HTMLSelectElement>('#author').addEventListener('change', (e) => {
  authorId = (e.target as HTMLSelectElement).value;
  host?.setAuthor(authorId);
});

// --- Review panel ------------------------------------------------------------

function describe(s: SuggestionSummary): string {
  if (s.type === 'format') {
    return `${s.formatAction === 'remove' ? 'Removed' : 'Applied'} ${s.formatMark ?? 'formatting'}`;
  }
  const verb = s.type === 'insertion' ? 'Added' : 'Deleted';
  if (s.nodeType === 'image') return `${verb} an image`;
  if (s.nodeType === 'tableRow') return `${verb} a table row`;
  if (s.nodeType && s.nodeType.startsWith('table')) return `${verb} a table cell`;
  return verb;
}

function timeAgo(t: number | null): string {
  if (!t) return '';
  const minutes = Math.round((Date.now() - t) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

function renderSuggestions(list: SuggestionSummary[]) {
  $('#count').textContent = String(list.length);
  $('#empty').hidden = list.length > 0;
  $<HTMLButtonElement>('#accept-all').disabled = list.length === 0;
  $<HTMLButtonElement>('#reject-all').disabled = list.length === 0;

  const ul = $('#suggestions');
  ul.replaceChildren(
    ...list.map((s) => {
      const author = AUTHORS[s.authorId ?? ''] ?? { name: s.authorId ?? 'Someone', color: '#64748b' };
      const li = document.createElement('li');
      li.className = `suggestion suggestion--${s.type}`;

      const avatar = document.createElement('span');
      avatar.className = 'avatar';
      avatar.style.background = author.color;
      avatar.textContent = author.name[0];
      avatar.setAttribute('aria-hidden', 'true');

      const body = document.createElement('button');
      body.type = 'button';
      body.className = 'suggestion-body';
      body.title = 'Show in document';
      const meta = document.createElement('span');
      meta.className = 'suggestion-meta';
      meta.textContent = `${author.name} · ${timeAgo(s.ts)}`;
      const what = document.createElement('span');
      what.className = 'suggestion-what';
      what.textContent = describe(s);
      body.append(meta, what);
      if (s.text.trim()) {
        const quote = document.createElement('span');
        quote.className = 'suggestion-text';
        quote.textContent = s.text.length > 70 ? `${s.text.slice(0, 70)}…` : s.text;
        body.append(quote);
      }
      body.addEventListener('click', () => {
        editor?.chain().focus().setTextSelection({ from: s.from, to: s.to }).scrollIntoView().run();
      });

      const actions = document.createElement('span');
      actions.className = 'suggestion-actions';
      const accept = document.createElement('button');
      accept.type = 'button';
      accept.className = 'icon-btn icon-btn--accept';
      accept.innerHTML = ICON_CHECK;
      accept.setAttribute('aria-label', `Accept: ${describe(s)} by ${author.name}`);
      accept.addEventListener('click', () => commands.accept(s.id));
      const reject = document.createElement('button');
      reject.type = 'button';
      reject.className = 'icon-btn icon-btn--reject';
      reject.innerHTML = ICON_X;
      reject.setAttribute('aria-label', `Reject: ${describe(s)} by ${author.name}`);
      reject.addEventListener('click', () => commands.reject(s.id));
      actions.append(accept, reject);

      li.append(avatar, body, actions);
      return li;
    }),
  );
}

$('#accept-all').addEventListener('click', () => commands.acceptAll());
$('#reject-all').addEventListener('click', () => commands.rejectAll());

// --- Stored HTML -------------------------------------------------------------

let outputTab: 'tracked' | 'clean' = 'tracked';

const pretty = (html: string) =>
  html.replace(/(<\/(?:p|h[1-6]|li|ul|ol|tr|tbody|table|blockquote)>)/g, '$1\n').trim();

function renderOutput() {
  const html = outputTab === 'tracked' ? commands.getHTML() : commands.getCleanHtml();
  $('#output').textContent = pretty(html ?? '');
}

for (const [id, tab] of [['#tab-tracked', 'tracked'], ['#tab-clean', 'clean']] as const) {
  $(id).addEventListener('click', () => {
    outputTab = tab;
    $('#tab-tracked').setAttribute('aria-selected', String(tab === 'tracked'));
    $('#tab-clean').setAttribute('aria-selected', String(tab === 'clean'));
    renderOutput();
  });
}

// --- Copy buttons ------------------------------------------------------------

async function copy(text: string, what: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${what} copied`);
  } catch {
    toast('Copy failed. Select the text and copy it manually');
  }
}

$('#copy-install').addEventListener('click', () => copy($('#install-cmd').textContent ?? '', 'Install command'));
$('#copy-code').addEventListener('click', () => copy($('#code').textContent ?? '', 'Code'));

// --- Start -------------------------------------------------------------------

setMode(mode);
const fromHash = location.hash.slice(1);
selectFramework(isFramework(fromHash) ? fromHash : 'vanilla');
