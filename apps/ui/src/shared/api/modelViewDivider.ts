/**
 * THE CHECKPOINT DIVIDER: the line in the transcript above which the agent no longer sees the
 * conversation word for word.
 *
 * Without it the person cannot tell why the agent "forgot" something said an hour ago — the
 * transcript still shows every turn, and nothing marks that the model's view no longer does.
 *
 * It is a client-owned notice anchored after the last evicted message, placed by the same
 * `afterMessageId` projection every notice uses, rather than a second way of drawing between
 * rows. One stable id, so a newer checkpoint MOVES the line instead of adding another: only
 * the view in force is true, and a trail of old lines would say the agent sees more than it
 * does.
 */
import type { Message, SessionModelView } from './contracts'

export const MODEL_VIEW_DIVIDER_ID = 'model-view-divider'

export function withModelViewDivider(
  messages: readonly Message[],
  modelView: SessionModelView | null | undefined,
): Message[] {
  const rest = messages.filter((message) => message.id !== MODEL_VIEW_DIVIDER_ID)
  if (!modelView) return rest
  // A detail body is a bounded TAIL, and a checkpoint evicts from the head, so an anchor the
  // body does not hold lies above everything loaded: the line goes first (`null`), not last,
  // where the projection would put an unknown anchor.
  const anchored = rest.some((message) => message.id === modelView.evictedThroughId)
  return [
    ...rest,
    {
      id: MODEL_VIEW_DIVIDER_ID,
      role: 'system',
      afterMessageId: anchored ? modelView.evictedThroughId : null,
      systemNotice: {
        kind: 'context_checkpoint',
        tone: 'neutral',
        text: 'Earlier turns checkpointed',
        detail:
          'Above this line the agent keeps short cards instead of the full turns. It can still ' +
          'look any of them up, and pinned messages stay whole.',
      },
    },
  ]
}
