/** Silence hides an empty turn, never the work recorded in its items. */
import { isTranscriptItemHidden } from '../../item-format'
import type { ConversationDecision } from '../../policy/axes/conversation'
import { TOOL } from '../../../agent-core/tool-names'
import type { AgentStreamEvent } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db'

/**
 * Whether this turn ends with the agent staying out of the conversation.
 *
 * Text, plans and visible tool activity make a turn public. Checking only `content` hid an
 * entire task-creation turn after its cards had streamed into the chat. Items are the transcript
 * source of truth too. Reasoning alone does not turn a silent acknowledgement into a public reply,
 * and hidden protocol calls (`set_topic`) follow the same per-item suppression rule as the UI.
 */
export function isSilentConversationTurn(
  room: Pick<ConversationDecision, 'silentEmptyTurns'>,
  payload: Pick<StoredMessagePayload, 'content' | 'items'>,
  /** The turn answers something that needs no reply — a reaction — even with one agent. */
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
  return silenceAllowed || room.silentEmptyTurns
}

/** The silent turn was the participant's explicit pass (`skip_answer`), not tool-only work. */
export function isPass(payload: Pick<StoredMessagePayload, 'items'>): boolean {
  return (
    payload.items?.some(
      (item) => 'name' in item && item.name === TOOL.skip_answer && item.status === 'completed',
    ) ?? false
  )
}

export interface ConversationSilenceIo {
  streamRegistry: { publish: (userId: string, sessionId: string, event: AgentStreamEvent) => void }
  /** Persist the row as given — the caller's own persist-and-publish, handed the payload to write. */
  persist: (payload: StoredMessagePayload) => Promise<void>
}

/**
 * Settle the assistant row: fill it, or HIDE it when the participant stayed out.
 *
 * Hidden, not deleted, and the difference is money. A participant that read the conversation and
 * decided to say nothing still paid for the read — on a three-agent conversation that was ~15%
 * of the session's tokens, all of it spent on turns that ended in `skip_answer`. Deleting the row
 * deleted its usage from the session's total (the footer sums the transcript), so the footer said
 * less than the ledger, and less than the truth. A hidden row keeps the usage on the branch, stays
 * out of the transcript (`isInternal` is what the UI already filters), and is withdrawn from every
 * live view so the empty bubble the streaming placeholder painted disappears too.
 *
 * It is also the durable fact that this participant READ the message and chose silence — the
 * "seen" the conversation's UI can show later without inventing a second record for it.
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
