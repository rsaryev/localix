/**
 * WHAT A MARK SAYS WHEN IT ASKS FOR A TURN.
 *
 * A reaction reaches a model twice and the two are different things. The tail reports marks
 * placed since it last spoke (`runtime/run/reaction-context.ts`) — background, read on any
 * turn. This is the FOREGROUND version: the person marked something just now, so a turn is
 * being started for it, and the prompt has to say which message and what the mark means.
 *
 * Deliberately short, and deliberately not an instruction. The agent decides whether a 👍 is
 * worth a word — an empty answer to a mark is silence, never a failed turn
 * (`isSilentConversationTurn`) — and a prompt that demanded a reply would turn every mark into a
 * paragraph, which is the problem reactions were added to solve.
 */
import type { StoredMessagePayload } from '../../../db'

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
    // The host treats an empty answer to a mark as silence (`isSilentConversationTurn`), so
    // "write nothing" is an instruction the model can carry out without a tool call.
    'Otherwise end your turn without writing anything: nothing is posted.',
  ].join('\n')
}
