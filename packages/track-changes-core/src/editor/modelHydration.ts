export type EditorModelValue = Record<string, unknown> | string | null;

function hasDocumentContent(value: unknown): boolean {
  if (typeof value === 'string') return value.trim().length > 0;
  if (!value || typeof value !== 'object') return false;

  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.length > 0) return true;
  if (record.type && record.type !== 'doc' && record.type !== 'paragraph') return true;
  return Array.isArray(record.content) && record.content.some(hasDocumentContent);
}

function signature(value: EditorModelValue): string {
  return typeof value === 'string' ? `html:${value}` : `json:${JSON.stringify(value)}`;
}

/**
 * Allows the one safe external-document synchronization case: an editor that
 * mounted empty may hydrate once when asynchronous data arrives. After the
 * editor has meaningful content, or after any local document change, external
 * replacements are ignored so selection, undo history, and unsaved edits stay
 * owned by the mounted editor.
 */
export function createModelHydrationGuard(initialValue: EditorModelValue) {
  let currentSignature = signature(initialValue);
  let hydrated = hasDocumentContent(initialValue);
  let locallyChanged = false;

  return {
    markLocalChange(value: EditorModelValue) {
      currentSignature = signature(value);
      locallyChanged = true;
    },
    shouldHydrate(value: EditorModelValue): boolean {
      const nextSignature = signature(value);
      if (nextSignature === currentSignature) return false;
      if (locallyChanged || hydrated) return false;

      currentSignature = nextSignature;
      hydrated = hasDocumentContent(value);
      return true;
    },
  };
}
