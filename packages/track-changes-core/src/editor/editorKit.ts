import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import {
  acceptOn,
  rejectOn,
  acceptAllOn,
  rejectAllOn,
  toClean,
  countCleanText,
  listSuggestions,
  type SuggestionSummary,
} from '../clean';
import {
  setSuggesting,
  suggestInsertNode,
  suggestDeleteNode,
} from '../commands';
import { tagSuggestionTx } from '../rewrite';
import { docToHtml } from '../html';
import type { EditorFeature, EditorToolbarItem } from './features/types';

/**
 * Framework-agnostic editor glue shared by the Vue, React, and vanilla
 * adapters. Each adapter owns only rendering and its framework's lifecycle;
 * everything that decides *what* the editor does lives here so the three
 * stay behaviorally identical.
 */

export type EditorMode = 'editing' | 'suggesting' | 'viewing';

/**
 * Persistence format for emitted values.
 *
 * - `json` — ProseMirror JSON document (object). Default.
 * - `html` — HTML string. Lossless: suggestions are real `<ins>`/`<del>` tags
 *   and `data-suggestion-*` attributes that round-trip through the schema's
 *   parse rules, so the value can be stored as plain text in a DB and renders
 *   correctly (including print/PDF) without the editor.
 */
export type EditorFormat = 'json' | 'html';

type Json = Record<string, unknown>;

export const EMPTY_DOC: Json = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * Formatting-gated StarterKit pieces, disabled unless a feature re-enables
 * them via `EditorFeature.starterKitOptions` (the formatting feature does,
 * per its `buttons`). Disabling removes the mark/node from the schema, so the
 * restriction is real: no keyboard shortcut, no markdown input rule, and
 * pasted formatting is stripped on parse. Structure (paragraphs, hard breaks,
 * history, cursors) stays enabled always.
 */
export const RESTRICTED_STARTER_KIT: Readonly<Record<string, unknown>> = {
  bold: false,
  italic: false,
  strike: false,
  code: false,
  heading: false,
  bulletList: false,
  orderedList: false,
  listItem: false,
  blockquote: false,
  codeBlock: false,
  horizontalRule: false,
};

/** StarterKit config: the restricted base with every feature's re-enables merged over it. */
export function resolveStarterKitOptions(features: readonly EditorFeature[]): Record<string, unknown> {
  return features.reduce<Record<string, unknown>>(
    (cfg, f) => ({ ...cfg, ...(f.starterKitOptions?.() ?? {}) }),
    { ...RESTRICTED_STARTER_KIT },
  );
}

/** Tiptap extensions contributed by the features, in feature order. */
export function featureExtensions(features: readonly EditorFeature[]) {
  return features.flatMap((f) => f.extensions?.() ?? []);
}

/** Toolbar items contributed by the features, in feature order. */
export function featureToolbarItems(features: readonly EditorFeature[]): EditorToolbarItem[] {
  return features.flatMap((f) => f.toolbarItems?.() ?? []);
}

export function isEditorEditable(mode: EditorMode, readonly: boolean): boolean {
  return !readonly && mode !== 'viewing';
}

/** The toolbar is hidden while the user can't edit. */
export function isToolbarVisible(mode: EditorMode, readonly: boolean): boolean {
  return isEditorEditable(mode, readonly);
}

/** The editor's current document in the requested persistence format. */
export function serializeEditor(editor: Editor, format: EditorFormat): Json | string {
  return format === 'html' ? editor.getHTML() : (editor.getJSON() as Json);
}

/** Imperative operations every adapter exposes (Vue template ref, React ref, vanilla handle). */
export interface TrackChangesEditorCommands {
  accept: (id: string) => void;
  reject: (id: string) => void;
  acceptAll: () => void;
  rejectAll: () => void;
  setSuggesting: (on: boolean) => void;
  /** Insert a node (inline atom or trackable block) as a tracked insertion. */
  insertNode: (node: PMNode, at?: number) => void;
  /** Suggest deletion of the node at `pos` (keep it, mark it deleted). */
  deleteNode: (pos: number) => void;
  listSuggestions: () => SuggestionSummary[];
  /** Accept-all projection as ProseMirror JSON (what you persist), or null. */
  getClean: () => Json | null;
  /** Current (tracked) document as an HTML string. */
  getHTML: () => string | null;
  /** Accept-all projection of the document as an HTML string. */
  getCleanHtml: () => string | null;
}

/**
 * Builds the imperative command set against whatever editor `getEditor`
 * currently returns; every command is a no-op while it returns null.
 *
 * Accept/reject dispatch straight on the view, so they work regardless of the
 * editor's readonly/viewing state (read-only blocks *user* typing, not
 * programmatic review actions).
 */
export function createEditorCommands(getEditor: () => Editor | null): TrackChangesEditorCommands {
  const applyTr = (mutate: (tr: Transaction) => void) => {
    const ed = getEditor();
    if (!ed) return;
    const tr = ed.state.tr;
    mutate(tr);
    // Accept/reject transactions are already suggestion-resolved; tag them so
    // the rewrite plugin doesn't re-encode them as new suggestions.
    if (tr.docChanged || tr.steps.length) ed.view.dispatch(tagSuggestionTx(tr));
  };

  const dispatchCmd = (
    cmd: (state: EditorState, dispatch: (tr: Transaction) => void) => boolean,
  ) => {
    const ed = getEditor();
    if (!ed) return;
    cmd(ed.state, (tr) => ed.view.dispatch(tr));
  };

  return {
    accept: (id) => applyTr((tr) => acceptOn(tr, id)),
    reject: (id) => applyTr((tr) => rejectOn(tr, id)),
    acceptAll: () => applyTr((tr) => acceptAllOn(tr)),
    rejectAll: () => applyTr((tr) => rejectAllOn(tr)),
    setSuggesting: (on) => dispatchCmd(setSuggesting(on)),
    insertNode: (node, at) => dispatchCmd(suggestInsertNode(node, at)),
    deleteNode: (pos) => dispatchCmd(suggestDeleteNode(pos)),
    listSuggestions: () => {
      const ed = getEditor();
      return ed ? listSuggestions(ed.state.doc) : [];
    },
    getClean: () => {
      const ed = getEditor();
      return ed ? (toClean(ed.state.doc).toJSON() as Json) : null;
    },
    getHTML: () => getEditor()?.getHTML() ?? null,
    getCleanHtml: () => {
      const ed = getEditor();
      return ed ? docToHtml(toClean(ed.state.doc)) : null;
    },
  };
}

export interface CharacterCountLimits {
  /**
   * Soft character limit. The count is of the *accept-all projection*: a
   * pending deletion stops counting immediately, a pending insertion counts
   * right away. Input is never hard-blocked (in suggesting mode the tracked
   * text physically stays in the doc, so blocking would be wrong) — enforce
   * at submit/validation time via the same projection.
   */
  maxCharacters?: number | null;
  /** Soft word limit (same clean-projection semantics as `maxCharacters`). */
  maxWords?: number | null;
  /** Show the counter even without a cap. */
  showCharacterCount?: boolean;
}

export interface CharacterCountView {
  characters: number;
  words: number;
  /** e.g. `123 / 2,000` with a cap, `123` without. */
  charText: string;
  /** e.g. `40 / 300w` with a cap, `40w` without. */
  wordText: string;
  charsOver: boolean;
  wordsOver: boolean;
  /** Any set cap exceeded. */
  over: boolean;
}

export function isCharacterCountVisible(limits: CharacterCountLimits): boolean {
  return limits.maxCharacters != null || limits.maxWords != null || !!limits.showCharacterCount;
}

export function characterCountView(doc: PMNode, limits: CharacterCountLimits): CharacterCountView {
  const { characters, words } = countCleanText(doc);
  const { maxCharacters, maxWords } = limits;
  const charsOver = maxCharacters != null && characters > maxCharacters;
  const wordsOver = maxWords != null && words > maxWords;
  return {
    characters,
    words,
    charText:
      maxCharacters != null
        ? `${characters.toLocaleString()} / ${maxCharacters.toLocaleString()}`
        : characters.toLocaleString(),
    wordText:
      maxWords != null
        ? `${words.toLocaleString()} / ${maxWords.toLocaleString()}w`
        : `${words.toLocaleString()}w`,
    charsOver,
    wordsOver,
    over: charsOver || wordsOver,
  };
}

/** Review operations shared by `useTrackChangesReview` (Vue/React) and the vanilla handle. */
export interface SuggestionReview
  extends Pick<TrackChangesEditorCommands, 'accept' | 'reject' | 'acceptAll' | 'rejectAll' | 'getClean'> {
  /** (Re)bind to an editor, or null to detach. Idempotent. */
  bind: (editor: Editor | null) => void;
  /** Current outstanding suggestions of the bound editor. */
  getSuggestions: () => SuggestionSummary[];
  /** Force a re-read of suggestions (rarely needed — updates are auto-tracked). */
  refresh: () => void;
  /** Detach from the editor; no further `onChange` calls. */
  destroy: () => void;
}

/**
 * Headless review controller: tracks the bound editor's suggestions and calls
 * `onChange` with the fresh list on every document change (and on bind).
 * Detaches automatically if the bound editor is destroyed.
 */
export function createSuggestionReview(
  onChange: (suggestions: SuggestionSummary[]) => void,
): SuggestionReview {
  let bound: Editor | null = null;
  let current: SuggestionSummary[] = [];

  const refresh = () => {
    current = bound ? listSuggestions(bound.state.doc) : [];
    onChange(current);
  };
  const onDestroy = () => bind(null);

  function bind(editor: Editor | null) {
    if (bound === editor) return;
    if (bound) {
      bound.off('update', refresh);
      bound.off('destroy', onDestroy);
    }
    bound = editor && !editor.isDestroyed ? editor : null;
    if (bound) {
      bound.on('update', refresh);
      bound.on('destroy', onDestroy);
    }
    refresh();
  }

  const commands = createEditorCommands(() => bound);

  return {
    bind,
    getSuggestions: () => current,
    refresh,
    accept: commands.accept,
    reject: commands.reject,
    acceptAll: commands.acceptAll,
    rejectAll: commands.rejectAll,
    getClean: commands.getClean,
    destroy: () => {
      if (bound) {
        bound.off('update', refresh);
        bound.off('destroy', onDestroy);
      }
      bound = null;
    },
  };
}
