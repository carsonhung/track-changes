import { ref, watch, onBeforeUnmount, type Ref } from 'vue';
import type { Editor } from '@tiptap/vue-3';
import type { Transaction } from '@tiptap/pm/state';
import {
  acceptOn,
  rejectOn,
  acceptAllOn,
  rejectAllOn,
  toClean,
  listSuggestions,
  tagSuggestionTx,
  type SuggestionSummary,
} from '@carsonhung/track-changes-core';

type Json = Record<string, unknown>;

/**
 * Minimal surface the composable reads from a `<TrackChangesEditor>` instance
 * (via a template ref). Only `editor` is required — accept/reject are driven
 * straight off the Tiptap `Editor`, so this also works with any bare editor
 * exposing `{ editor }`.
 */
export interface TrackChangesEditorLike {
  editor?: Editor | null;
}

export interface UseTrackChangesReview {
  /** Reactive list of outstanding suggestions, refreshed on every doc change. */
  suggestions: Ref<SuggestionSummary[]>;
  /** Reactive `suggestions.length > 0`. */
  hasSuggestions: Ref<boolean>;
  /** Accept one suggestion by id (works even when the editor is read-only). */
  accept: (id: string) => void;
  /** Reject one suggestion by id. */
  reject: (id: string) => void;
  /** Accept every suggestion in the document. */
  acceptAll: () => void;
  /** Reject every suggestion in the document. */
  rejectAll: () => void;
  /** The accept-all projection as ProseMirror JSON (what you persist), or null. */
  getClean: () => Json | null;
  /** Force a re-read of suggestions (rarely needed — updates are auto-tracked). */
  refresh: () => void;
}

/**
 * Headless review primitive: given a ref to a `<TrackChangesEditor>` (or any
 * object exposing a Tiptap `editor`), returns a reactive list of suggestions
 * plus accept/reject helpers. The host renders its own UI (sidebar, inline
 * affordances, etc.) — this composable ships no markup, keeping it
 * style-agnostic and portable.
 *
 * Accept/reject dispatch transactions directly on the editor view, so they
 * function regardless of the editor's `readonly` / `viewing` state (read-only
 * blocks *user* typing, not programmatic review actions).
 */
export function useTrackChangesReview(
  source: Ref<TrackChangesEditorLike | null | undefined>,
): UseTrackChangesReview {
  const suggestions = ref<SuggestionSummary[]>([]);
  const hasSuggestions = ref(false);
  let bound: Editor | null = null;

  function refresh() {
    const list = bound ? listSuggestions(bound.state.doc) : [];
    suggestions.value = list;
    hasSuggestions.value = list.length > 0;
  }

  function bindTo(editor: Editor | null) {
    if (bound === editor) return;
    if (bound) bound.off('update', refresh);
    bound = editor;
    if (bound) bound.on('update', refresh);
    refresh();
  }

  watch(() => source.value?.editor ?? null, bindTo, { immediate: true });

  onBeforeUnmount(() => {
    if (bound) bound.off('update', refresh);
    bound = null;
  });

  function applyTr(mutate: (tr: Transaction) => void) {
    if (!bound) return;
    const tr = bound.state.tr;
    mutate(tr);
    // Resolution transactions must not be re-encoded by the rewrite plugin.
    if (tr.docChanged || tr.steps.length) bound.view.dispatch(tagSuggestionTx(tr));
  }

  return {
    suggestions,
    hasSuggestions,
    accept: (id: string) => applyTr((tr) => acceptOn(tr, id)),
    reject: (id: string) => applyTr((tr) => rejectOn(tr, id)),
    acceptAll: () => applyTr((tr) => acceptAllOn(tr)),
    rejectAll: () => applyTr((tr) => rejectAllOn(tr)),
    getClean: () => (bound ? (toClean(bound.state.doc).toJSON() as Json) : null),
    refresh,
  };
}
