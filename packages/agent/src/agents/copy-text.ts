import type { AgentItem } from './items'
import { isTextItem } from './items'

/**
 * Lossless user-facing prose for copy/export actions.
 *
 * Tool-using assistant turns keep their ordered prose in `items[]` and commonly
 * leave the flat `content` empty. Prefer those source items whenever present,
 * exclude private reasoning and tool payloads, and fall back to `content` for
 * messages that have no narrative items (a user's message, for one).
 */
export function copyableMessageText(message: {
  content?: string
  items?: readonly AgentItem[]
}): string | null {
  const narrative = (message.items ?? []).flatMap((item) =>
    isTextItem(item) && item.text.trim().length > 0 ? [item.text] : [],
  )
  const text = narrative.length > 0 ? narrative.join('\n\n') : (message.content ?? '')
  return text.trim().length > 0 ? text : null
}
