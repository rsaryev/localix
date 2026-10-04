/**
 * WHAT A MARK SAYS WHEN IT ASKS FOR A TURN.
 *
 * A reaction reaches a model twice and the two are different things. The tail reports marks
 * placed since it last spoke (`runtime/run/reaction-context.ts`) — background, read on any
 * turn. This is the FOREGROUND version: the person marked something just now, so a turn is
 * being started for it, and the prompt has to say which message and what the mark means.
 *
 * Deliberately short, and deliberately not an instruction. The agent decides whether a 👍 is
 * worth a word — `conversation_control` is in its roster precisely so silence stays an option
 * — and a prompt that demanded a reply would turn every mark into a paragraph, which is the
 * problem reactions were added to solve.
 */
import type { StoredMessagePayload } from '../../../db'
import { isAgentParticipant } from '../../../db/participant'

/** How much of the marked message is quoted back, so the agent knows which one it was. */
const QUOTE_CHARS = 120

/** What each mark means, in the words the tool's own schema uses. */
const MEANING: Record<string, string> = {
  '👍': 'agreed, nothing to add',
  '👀': 'read it, taking a look',
  '✅': 'done, or confirmed working',
  '❌': 'wrong, or does not work',
  '🤔': 'unclear, or has doubts',
  '🎉': 'a good result worth marking',
}

export function reactionWakePrompt(emoji: string, payload: StoredMessagePayload): string {
  const text = typeof payload.content === 'string' ? payload.content.trim() : ''
  const quote = text
    ? `\n\n> ${text.slice(0, QUOTE_CHARS)}${text.length > QUOTE_CHARS ? '…' : ''}`
    : ''
  const meaning = MEANING[emoji]
  return [
    `The user reacted ${emoji}${meaning ? ` (${meaning})` : ''} to this message:${quote}`,
    '',
    'Answer only if the mark asks for something — a correction, a fix, a clearer explanation.',
    // "Say nothing" is not an instruction a model can carry out: an empty turn is a FAILED
    // turn, and the runtime writes "Something went wrong" into the conversation. Observed
    // exactly that on the first 👍 this shipped with. Silence has to be an action, and it is.
    'Otherwise call `conversation_control` with next:[] — that ends your turn without posting. Do not reply with an empty message.',
  ].join('\n')
}

/**
 * The participant a marked message belongs to, so a room narrows the turn to them.
 *
 * Absent for the person's own messages and for the application's: those have no member to
 * address, and the turn reaches the room as an ordinary one.
 */
export function reactionRecipient(
  payload: StoredMessagePayload,
): { participant: `agent:${string}`; handle?: string } | undefined {
  const from = payload.from
  if (typeof from !== 'string' || !isAgentParticipant(from)) return undefined
  return {
    participant: from,
    ...(payload.authorSnapshot?.handle ? { handle: payload.authorSnapshot.handle } : {}),
  }
}
