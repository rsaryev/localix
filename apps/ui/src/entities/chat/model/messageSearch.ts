/**
 * Pure match logic for in-conversation search. Structural input (no heavy
 * `Message` import) so it's trivially testable. Matches a case-insensitive
 * substring against each message's `content` — the same text the per-message
 * Copy + the Markdown export use — and skips non-conversational rows (system
 * notices, internal continuation prompts, ui-only dividers).
 */
export interface SearchableMessage {
  id: string
  role: string
  content?: string
  isInternal?: boolean
  uiOnly?: boolean
}

/** A searchable message reduced to its id + a pre-lowercased body. */
export interface MessageSearchIndexEntry {
  id: string
  haystack: string
}

/**
 * Lowercase every conversational message ONCE, so typing in the find bar costs a
 * `String.includes` per message instead of a full `toLowerCase()` of the whole
 * transcript per keystroke. Rebuild only when the message list itself changes.
 */
export function buildMessageSearchIndex(messages: SearchableMessage[]): MessageSearchIndexEntry[] {
  const out: MessageSearchIndexEntry[] = []
  for (const m of messages) {
    if (m.isInternal || m.uiOnly || m.role === 'system') continue
    out.push({ id: m.id, haystack: (m.content ?? '').toLowerCase() })
  }
  return out
}

/** Ordered ids from a prebuilt index whose text contains `query` (empty for a blank query). */
export function matchingIndexedIds(index: MessageSearchIndexEntry[], query: string): string[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const out: string[] = []
  for (const entry of index) {
    if (entry.haystack.includes(q)) out.push(entry.id)
  }
  return out
}
