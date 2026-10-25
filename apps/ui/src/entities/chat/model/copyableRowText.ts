import { copyableMessageText } from '@localixai/agent/agents'
import type { Message } from '@/shared/api/contracts'

/**
 * What "Copy text" copies for one card: the prose of each message of a continued answer, joined
 * by a blank line. The message menu and `/copy` both read it, so they cannot copy different text.
 */
export function copyableRowText(parts: readonly Message[]): string | null {
  const text = parts
    .map((part) => copyableMessageText(part))
    .filter(Boolean)
    .join('\n\n')
  return text || null
}
