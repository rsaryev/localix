/**
 * WHICH QUESTIONS AN `ask` CALL ASKS, AND THE `wait: false` PATH THAT ASKS THEM WITHOUT WAITING.
 *
 * Split from the tool itself because these are the parts that talk to the host's queue
 * (`AskQueuePort`), while `ask.ts` owns the schema and the blocking card. The questions come one
 * of two ways — written out, or recalled by `from`, the id of one the agent asked before — so a
 * re-ask costs an id instead of the whole question regenerated.
 */
import type { AgentToolResult } from '@localixai/agent/agents'

import type { AskToolDetails, AskToolInput } from './ask'
import {
  queuedResultText,
  stillOpenText,
  type AskQueuePort,
  type RecalledQuestion,
} from './ask-queue'

export type AskedQuestions = RecalledQuestion & { recalled: boolean }

export const NO_QUEUE: AgentToolResult<AskToolDetails> = {
  content:
    'Queued questions are not available in this run. Ask with wait: true if the next step needs the answer, or proceed on your own judgement and state the assumption.',
  isError: true,
}

/** `from`: look the earlier question up, by `q-N` or by an earlier `ask` call's id. */
export async function recallQuestions(
  queue: AskQueuePort | undefined,
  from: string,
): Promise<AskedQuestions | AgentToolResult<AskToolDetails>> {
  if (!queue) return NO_QUEUE
  const recalled = await queue.recall(from)
  if ('refused' in recalled) return { content: recalled.refused, isError: true }
  return { ...recalled, recalled: true }
}

/**
 * Synchronous on purpose: a written-out ask raises its card in the same tick it is called, as it
 * always did — only a recall, which has to look the question up, pays an await.
 */
export function writtenQuestions(
  input: AskToolInput,
): AskedQuestions | AgentToolResult<AskToolDetails> {
  if (input.questions) return { questions: input.questions, recalled: false }
  return {
    content: 'Give questions, or from with the id of an earlier question to ask it again.',
    isError: true,
  }
}

/**
 * `wait: false` — record the question with the host and return at once. Nothing here waits, so
 * nothing here can expire: the question stays open until the person answers or skips it, and the
 * host delivers that outcome to the agent (`ask-queue.ts` words every part of it).
 */
export async function queueQuestion(
  queue: AskQueuePort | undefined,
  toolCallId: string,
  asked: AskedQuestions,
): Promise<AgentToolResult<AskToolDetails>> {
  if (!queue) return NO_QUEUE
  const questions = asked.recalled ? { questions: asked.questions } : {}
  // Re-queuing what is still waiting would put the same card in the strip twice.
  if (asked.openQuestionId)
    return {
      content: stillOpenText(asked.openQuestionId),
      details: { ...questions, stillOpen: asked.openQuestionId },
    }
  const { questionId, superseded } = await queue.queue({ toolCallId, questions: asked.questions })
  return {
    content: queuedResultText(questionId, superseded),
    details: { ...questions, queued: { questionId, status: 'pending' } },
  }
}
