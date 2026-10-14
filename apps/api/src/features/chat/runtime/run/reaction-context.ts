/**
 * TELLING AN AGENT WHAT WAS MARKED SINCE IT LAST SPOKE.
 *
 * A reaction is a message about a message, and it has to reach the model or it is decoration:
 * asked outright, members answered "reactions do not reach me, say it in words" — which was
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
 * Not a room-only section. A person marks a message in a one-to-one chat too, and there the
 * mark is the whole of what they said that turn.
 *
 * WHICH marks are new is answered by the transcript rather than by a `seen` flag anywhere: a
 * reaction placed AFTER this member's own last row is one it has not been told about, because
 * its previous turn was built before that mark existed. No extra state, no extra write, and a
 * retried turn tells the same story as the first attempt.
 */
import type { PersistedMessage } from '../../contracts'
import { isAgentParticipant } from '../../../../db/participant'

/** How much of the marked message is quoted back, so the member knows which one it was. */
const QUOTE_CHARS = 60
/** At most this many marks, newest last — a tail section is not a log. */
const MAX_MARKS = 12

function authorWord(from: string, viewer: string): string {
  if (from === viewer) return 'you'
  if (!isAgentParticipant(from)) return 'the user'
  return from.slice('agent:'.length).replace(/^builtin:/, '')
}

/**
 * The section, or nothing when nobody has marked anything since this member last spoke.
 *
 * Nothing is the ordinary case and it costs the prompt no bytes, which matters: this runs on
 * every turn of every member of every room.
 */
export function buildReactionContext(
  messages: readonly PersistedMessage[],
  viewer: string,
): string | undefined {
  // The member's own last row bounds "new". A member that has not spoken yet has no bound, and
  // every mark in the conversation is news to it.
  const since = [...messages]
    .reverse()
    .find((message) => message.payload.from === viewer)?.createdAt

  const lines: string[] = []
  for (const message of messages) {
    for (const reaction of message.payload.reactions ?? []) {
      if (since && reaction.at <= since) continue
      // A member's own mark is not news to itself.
      if (reaction.from === viewer) continue
      const text = typeof message.payload.content === 'string' ? message.payload.content.trim() : ''
      const whose =
        message.payload.from === viewer
          ? 'your message'
          : `${authorWord(String(message.payload.from ?? ''), viewer)}'s message`
      const quote = text
        ? ` “${text.slice(0, QUOTE_CHARS)}${text.length > QUOTE_CHARS ? '…' : ''}”`
        : ''
      lines.push(
        `- ${authorWord(reaction.from, viewer)} reacted ${reaction.emoji} to ${whose}${quote}`,
      )
    }
  }
  if (lines.length === 0) return undefined
  return ['# Reactions since your last turn', ...lines.slice(-MAX_MARKS)].join('\n')
}
