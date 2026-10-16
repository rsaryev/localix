import type { StoredMessagePayload } from '../../../db/payload'

/**
 * Append one text part to a reply. Each text part the model emits — after reasoning, after a tool
 * call, or as the next message of the same response — starts a paragraph, so "@design, draft it"
 * and "Here is the plan" never run together (LOCALIX-135, -156). Fragments of one part, as they
 * stream, join verbatim; whitespace already at the seam is kept.
 */
export function appendSpokenText(text: string, part: string, newPart: boolean): string {
  if (!newPart || !text || !part || /\s$/.test(text) || /^\s/.test(part)) return text + part
  return `${text}\n\n${part}`
}

/**
 * Everything a turn said, in order: every text item of every model call, as the person reads it.
 *
 * `content` keeps only the last model call's text, which is right for a channel reply but loses
 * whatever the agent said before a tool call. In a conversation that earlier text can be the turn's
 * whole point — "@design, draft the concept", then `ask`, then "I asked the person a few
 * questions" (LOCALIX-136) — so routing and colleagues read this instead. A row without text
 * items (older rows, hook-rewritten replies with none) falls back to `content`.
 */
export function publishedText(payload: Pick<StoredMessagePayload, 'content' | 'items'>): string {
  let text = ''
  for (const item of payload.items ?? []) {
    if (item.type !== 'text' || !item.text.trim()) continue
    text = appendSpokenText(text, item.text, true)
  }
  const content = typeof payload.content === 'string' ? payload.content.trim() : ''
  return text.trim() || content
}
