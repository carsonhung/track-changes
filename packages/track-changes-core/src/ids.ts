let counter = 0;

/**
 * Generate a collision-resistant suggestion id. Suggestions are grouped by id,
 * so consecutive keystrokes that adopt the same adjacent insertion reuse an id
 * (see `commands.ts`). The format is opaque; never parse it.
 */
export function createSuggestionId(): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `sg-${Date.now().toString(36)}-${(counter++).toString(36)}-${rand}`;
}
