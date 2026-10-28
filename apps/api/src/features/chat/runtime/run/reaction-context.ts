/**
 * TELLING AN AGENT WHAT WAS MARKED SINCE IT LAST SPOKE.
 *
 * A reaction is a message about a message, and it has to reach the model or it is decoration:
 * asked outright, agents answered "reactions do not reach me, say it in words" — which was
 * true, and made the whole gesture worthless to them.
 *
 * It does NOT reach them by rewriting the message that was marked. That is the tempting
 * version and it is the wrong one: an older row edited in place changes bytes the prompt cache
 * has already committed to, so every marked message would invalidate the prefix after it, and a
 * conversation's cost is exactly what the prefix cache is holding down. So reactions are
 * announced on the NEXT turn, never on the reacted row.
 *
 * So the marks arrive in the VOLATILE tail, the part re-injected after the cached prefix each
 * turn, beside the live facts a run already gets there.
 *
 * A mark can be the whole of what the person said that turn.
 *
 * WHICH marks are new is answered by the transcript rather than by a `seen` flag anywhere: a
 * reaction placed AFTER this agent's own last row is one it has not been told about, because
 * its previous turn was built before that mark existed. No extra state, no extra write, and a
 * retried turn tells the same story as the first attempt.
 */
import type { PersistedMessage } from '../../contracts'

/** How much of the marked message is quoted back, so the agent knows which one it was. */
const QUOTE_CHARS = 60
/** At most this many marks, newest last — a tail section is not a log. */
const MAX_MARKS = 12

/**
 * The section, or nothing when nobody has marked anything since this agent last spoke.
 *
 * Nothing is the ordinary case and it costs the prompt no bytes, which matters: this runs on
 * every turn of every run.
 */
export function buildReactionContext(
  messages: readonly PersistedMessage[],
  viewer: string,
): string | undefined {
  // The agent's own last row bounds "new". An agent that has not spoken yet has no bound, and
  // every mark in the conversation is news to it.
  const since = [...messages]
    .reverse()
    .find((message) => message.payload.from === viewer)?.createdAt

  const lines: string[] = []
  for (const message of messages) {
    for (const reaction of message.payload.reactions ?? []) {
      if (since && reaction.at <= since) continue
      const text = typeof message.payload.content === 'string' ? message.payload.content.trim() : ''
      const whose = message.payload.from === viewer ? 'your message' : 'the user’s message'
      const quote = text
        ? ` “${text.slice(0, QUOTE_CHARS)}${text.length > QUOTE_CHARS ? '…' : ''}”`
        : ''
      lines.push(`- the user reacted ${reaction.emoji} to ${whose}${quote}`)
    }
  }
  if (lines.length === 0) return undefined
  return ['# Reactions since your last turn', ...lines.slice(-MAX_MARKS)].join('\n')
}
