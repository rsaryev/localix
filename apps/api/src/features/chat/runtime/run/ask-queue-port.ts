/**
 * THE HOST HALF OF `ask`'S QUEUE, bound to one run: the session, and the participant asking.
 *
 * `recall` is what lets the agent ask a question again by an id it already holds rather than
 * writing the question out again — the shape `tool_output` uses to serve an earlier result by its
 * call id. Two kinds of id reach it, because the agent holds two:
 *
 *   q-N            a queued question, open or closed (`features/questions`);
 *   tool_call_id   an earlier `ask` call — a blocking one that expired is the case that matters,
 *                  since it was never queued and its questions live only on its transcript item.
 *
 * A question belongs to the participant that asked it: in a room, one member re-asking — and so
 * closing — a colleague's open question would take it from the person they asked.
 */
import { isToolCallItem } from '@localixai/agent/agents'

import { agentParticipant } from '../../../../db/participant'
import { TOOL } from '../../../agent-core/tool-names'
import type { AskToolDetails, AskToolInput } from '../../../agent-core/tools/hitl/ask'
import { recallRefusal, type AskQueuePort } from '../../../agent-core/tools/hitl/ask-queue'
import type { QuestionRegistry } from '../../../questions/registry'
import type { ChatRepository } from '../../repository'

const QUEUED_ID = /^q-\d+$/

export function createAskQueuePort(input: {
  questions: QuestionRegistry
  repo: Pick<ChatRepository, 'findActiveBranchToolCallMessage'>
  userId: string
  sessionId: string
  agentId: string
}): AskQueuePort {
  const { questions, repo, agentId } = input
  const owner = { userId: input.userId, sessionId: input.sessionId }

  const recallQueued: AskQueuePort['recall'] = async (id) => {
    const record = await questions.find(owner, id)
    if (!record) return { refused: recallRefusal.unknown(id) }
    if (record.agentId !== agentId) return { refused: recallRefusal.colleague(id) }
    return {
      questions: record.questions,
      ...(record.status === 'pending' ? { openQuestionId: record.displayId } : {}),
    }
  }

  const recallCall: AskQueuePort['recall'] = async (id) => {
    const message = await repo.findActiveBranchToolCallMessage(owner.userId, owner.sessionId, id)
    const item = message?.payload.items?.find(
      (candidate) => isToolCallItem(candidate) && candidate.toolCallId === id,
    )
    if (!message || !item || !isToolCallItem(item)) return { refused: recallRefusal.unknown(id) }
    if (item.name !== TOOL.ask) return { refused: recallRefusal.notAsk(id) }
    if (message.payload.from !== agentParticipant(agentId))
      return { refused: recallRefusal.colleague(id) }
    // Written out on the call, or recalled by it (then its details carry them).
    const recalled =
      (item.input as AskToolInput | undefined)?.questions ??
      (item.output as AskToolDetails | undefined)?.questions
    if (!recalled?.length) return { refused: recallRefusal.unknown(id) }
    // A call that queued its question names it: recall THAT, so an open one is not asked twice.
    const queuedId = (item.output as AskToolDetails | undefined)?.queued?.questionId
    return queuedId ? recallQueued(queuedId) : { questions: recalled }
  }

  return {
    async queue({ toolCallId, questions: asked }) {
      const { record, superseded } = await questions.ask({
        owner,
        agentId,
        toolCallId,
        questions: asked,
      })
      return { questionId: record.displayId, superseded }
    },
    recall: (id) => (QUEUED_ID.test(id) ? recallQueued(id) : recallCall(id)),
    async supersede(questionId) {
      await questions.supersede(owner, questionId)
    },
  }
}
