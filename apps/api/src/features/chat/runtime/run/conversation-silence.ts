/** Silence hides an empty turn, never the work recorded in its items. */
import { isTranscriptItemHidden } from '../../item-format'
import type { AgentStreamEvent } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db'

/**
 * Whether this turn ends with the agent staying out of the conversation.
 *
 * Text, plans and visible tool activity make a turn public. Checking only `content` hid an
 * entire task-creation turn after its cards had streamed into the chat. Items are the transcript
 * source of truth too. Reasoning alone does not turn a silent acknowledgement into a public reply,
 * and hidden protocol calls follow the same per-item suppression rule as the UI.
 */
export function isSilentConversationTurn(
  payload: Pick<StoredMessagePayload, 'content' | 'items'>,
  /** The turn answers something that needs no reply — a reaction. */
  silenceAllowed = false,
): boolean {
  if (payload.content?.trim()) return false
  if (
    payload.items?.some((item) => {
      if (item.type === 'reasoning') return false
      if (item.type === 'text') return Boolean(item.text.trim())
      return !isTranscriptItemHidden(item)
    })
  )
    return false
  if (payload.items?.some((item) => item.status === 'completed' && isTranscriptItemHidden(item)))
    return true
  return silenceAllowed
}

export interface ConversationSilenceIo {
  streamRegistry: { publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void }
  /** Persist the row as given — the caller's own persist-and-publish, handed the payload to write. */
  persist: (payload: StoredMessagePayload) => Promise<void>
}

/**
 * Settle the assistant row: fill it, or HIDE it when the agent stayed out of the conversation.
 *
 * Hidden, not deleted, and the difference is money. A turn that read the conversation and said
 * nothing still paid for the read; deleting the row deleted its usage from the session's total
 * (the footer sums the transcript), so the footer said less than the ledger. A hidden row keeps
 * the usage on the branch, stays out of the transcript (`isInternal` is what the UI already
 * filters), and is withdrawn from every live view so the empty bubble the streaming placeholder
 * painted disappears too.
 *
 * One function rather than a predicate the caller branches on, because the two halves must not
 * drift apart — a row hidden but still shown, or shown after being hidden, is a transcript that
 * disagrees with itself.
 */
export async function settleConversationTurn(
  io: ConversationSilenceIo,
  args: { silent: boolean; userId: string; sessionId: string; payload: StoredMessagePayload },
): Promise<void> {
  const { silent, userId, sessionId, payload } = args
  if (!silent) return io.persist(payload)
  await io.persist({ ...payload, content: '', isInternal: true })
  io.streamRegistry.publish(userId, sessionId, {
    type: 'message.removed',
    sessionId,
    messageId: payload.id,
  })
}
