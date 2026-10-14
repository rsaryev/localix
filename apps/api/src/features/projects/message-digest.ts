/**
 * Pure builder for the `@message:<sessionId>/<messageId>` context-ref expansion —
 * ONE transcript message reduced to its role + (capped) text. This carries only
 * content the user already sees in the transcript; nothing more.
 *
 * Kept free of DB / IO so the trimming rules stay unit-testable; the data is loaded
 * by the caller (bootstrap) from the chat repository and mapped into the input.
 */

export interface MessageDigestInput {
  sessionId: string
  messageId: string
  role: string
  /** The message's plain text (already flattened from items/content). */
  text: string
}

/** Max chars kept from the message body (longer messages are ellipsized). */
export const MESSAGE_DIGEST_MAX_CHARS = 4000

function roleLabel(role: string): string {
  if (role === 'user') return 'user'
  if (role === 'assistant') return 'assistant'
  if (role === 'system') return 'system'
  return role || 'assistant'
}

/** Renders the single-message digest block. */
export function buildMessageDigest(input: MessageDigestInput): string {
  const body = input.text.trim()
  const truncated = body.length > MESSAGE_DIGEST_MAX_CHARS
  const shown = truncated
    ? `${body.slice(0, MESSAGE_DIGEST_MAX_CHARS).trimEnd()}\n[…truncated…]`
    : body
  const lines: string[] = []
  lines.push(`Message from session ${input.sessionId} (${roleLabel(input.role)}):`)
  lines.push(shown || '(empty message)')
  return lines.join('\n')
}
