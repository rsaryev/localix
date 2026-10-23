/**
 * TICKING A BOX in a reply's checklist (GFM `- [ ] item`): the person's mark on the message.
 *
 * Message state like a pin or a reaction, for the same reason: stored on the row and published as
 * `message.updated`, so every window shows the same marks and a reload keeps them. It never
 * reaches the model — the agent's text is unchanged; the marks are the reader's.
 */
import { writeMessageState, type MessagePinIo } from './message-pins'

/** A reply holds a few dozen boxes at most; the ceiling bounds what a client can make us store. */
export const MAX_TASK_STATES = 500

/** Set one box; false when the message is gone, is the person's own, or already in that state. */
export async function setMessageTask(
  io: MessagePinIo,
  params: { userId: string; sessionId: string; messageId: string; key: string; checked: boolean },
): Promise<boolean> {
  const message = await io.repo.getMessage(params.userId, params.sessionId, params.messageId)
  if (message?.payload.role !== 'assistant') return false
  const states = message.payload.taskStates ?? {}
  if ((states[params.key] ?? false) === params.checked && params.key in states) return false
  const next = { ...states, [params.key]: params.checked }
  if (Object.keys(next).length > MAX_TASK_STATES) return false
  await writeMessageState(io, params, message, { taskStates: next })
  return true
}
