import { useEffect, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { createSuggestionReview, type SuggestionSummary } from 'track-changes-core';

type Json = Record<string, unknown>;

export interface UseTrackChangesReview {
  /** Outstanding suggestions, refreshed on every doc change. */
  suggestions: SuggestionSummary[];
  /** `suggestions.length > 0`. */
  hasSuggestions: boolean;
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
 * Headless review primitive: given the Tiptap editor (e.g. captured via
 * `<TrackChangesEditor onReady={setEditor}>`), returns the live list of
 * suggestions plus accept/reject helpers. Ships no markup — the host renders
 * its own review UI. All returned functions are stable across renders.
 */
export function useTrackChangesReview(editor: Editor | null | undefined): UseTrackChangesReview {
  const [suggestions, setSuggestions] = useState<SuggestionSummary[]>([]);
  const [review] = useState(() => createSuggestionReview(setSuggestions));

  useEffect(() => {
    review.bind(editor ?? null);
  }, [review, editor]);

  useEffect(() => () => review.destroy(), [review]);

  return {
    suggestions,
    hasSuggestions: suggestions.length > 0,
    accept: review.accept,
    reject: review.reject,
    acceptAll: review.acceptAll,
    rejectAll: review.rejectAll,
    getClean: review.getClean,
    refresh: review.refresh,
  };
}
