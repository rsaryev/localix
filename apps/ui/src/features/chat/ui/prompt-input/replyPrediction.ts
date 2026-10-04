/**
 * WHEN AN EMPTY COMPOSER PREDICTS THE PERSON'S REPLY — and when it stays quiet.
 *
 * An empty composer used to ask for "the most likely next request" whenever it was focused and
 * its cache had lapsed: on a session the person opened to read, after their own message, while a
 * question card waited — each focus a paid call, most of them for a ghost nobody wanted. A reply
 * prediction now has one subject, the agent's LAST message, and is made at most once for it:
 *
 *   subject   the last visible message is the agent's, with words in it to reply to — not the
 *             person's own line, not a system notice (an error, a restart), not a tool-only row;
 *   quiet     while anything else is the person's to answer: a queued message, an open
 *             interaction card, a question in the strip;
 *   fresh     a reply this window watched being written, or one written recently — opening an
 *             old conversation is reading, not replying, and should not cost a call;
 *   timing    a short pause after the reply settles, so a person who starts typing at once never
 *             pays for a ghost, and the prediction is ready by the time they reach the input.
 *
 * Pure, so every rule is a unit test; `useChatInlineCompletion` applies it.
 */
import type { Message, UiSession } from '@/shared/api/contracts'

/** The pause after a reply settles before its prediction is asked for. */
export const REPLY_PREDICTION_DELAY_MS = 2_500
/** A reply older than this, not watched live, belongs to a conversation being read. */
export const REPLY_PREDICTION_FRESH_MS = 15 * 60_000

/** Rows the person does not see as conversation: hidden wakes, dividers, live terminal markers. */
const isConversationRow = (message: Message) =>
  !message.isInternal && !message.uiOnly && !message.terminalLifecycle

const hasWords = (message: Message) =>
  Boolean(message.content?.trim()) ||
  (message.items ?? []).some((item) => item.type === 'text' && Boolean(item.text.trim()))

/** The agent's message a reply would answer, or null when there is none to answer now. */
export function replyPredictionSubject(
  session:
    | Pick<UiSession, 'messages' | 'queuedMessages' | 'pendingInteraction' | 'questions'>
    | undefined,
): Message | null {
  if (!session) return null
  if (session.queuedMessages.length > 0) return null
  if (session.pendingInteraction) return null
  if ((session.questions?.length ?? 0) > 0) return null
  // From the end, without copying: this runs in a store selector, once per streamed token.
  for (let index = session.messages.length - 1; index >= 0; index--) {
    const message = session.messages[index]!
    if (!isConversationRow(message)) continue
    if (message.role !== 'assistant' || message.optimistic || !hasWords(message)) return null
    return message
  }
  return null
}

/** Is this subject worth a call: watched live, or recent enough to still be the conversation? */
export function isFreshReplySubject(
  subject: Pick<Message, 'id' | 'createdAt'>,
  watchedLive: ReadonlySet<string>,
  now: number,
): boolean {
  if (watchedLive.has(subject.id)) return true
  const createdAt = subject.createdAt ? Date.parse(subject.createdAt) : Number.NaN
  return Number.isFinite(createdAt) && now - createdAt <= REPLY_PREDICTION_FRESH_MS
}

/** How long to wait before asking, counted from when this window first saw the reply settled. */
export function replyPredictionDelayMs(settledAt: number, now: number): number {
  return Math.max(0, settledAt + REPLY_PREDICTION_DELAY_MS - now)
}
