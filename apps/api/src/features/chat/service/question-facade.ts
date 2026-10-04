/**
 * THE PERSON'S SIDE OF A QUEUED QUESTION — answering it, skipping it, and what each one causes.
 *
 * Two halves, because a question can close in more ways than the person closing it:
 *
 *   answer / skip   validate → close the row (`features/questions` decides, once, who won a race
 *                   between two tabs) — nothing else; the consequence is not theirs to deliver;
 *   settle          THE consequence of any close, the agent re-asking included: the `ask` card
 *                   shows how it ended, and the agent hears about it — the answer as a turn (or
 *                   at the next step of the run already going), delivered once ever and
 *                   re-sent after a crash; a skip in its next prompt; a superseded question not
 *                   at all (the agent did it).
 *
 * `settle` is wired once, to the registry's `onResolved` (`bootstrap/session-services.ts`), so a
 * close cannot reach the transcript without reaching the agent, or the other way round.
 */
import { isToolCallItem } from '@localixai/agent/agents'

import { agentParticipant } from '../../../db/participant'
import { ApiError } from '../../../lib/errors'
import type { AskToolAnswer, AskToolDetails } from '../../agent-core/tools/hitl/ask'
import { queuedAnswerText } from '../../agent-core/tools/hitl/ask-queue'
import { answerDeliveryKey, type QuestionRecord } from '../../questions/contracts'
import { receiptHorizon, recordDecidedDelivery } from '../runtime/delivery-receipts'
import type { ChatServiceDeps } from './context'
import type { QuestionRegistry, QuestionResolveResult } from '../../questions/registry'
import { publishMessageSnapshot } from '../runtime/message-persistence'
import { sessionQuestions } from '../runtime/question-view'
import type { ChatServiceGraph } from './service-graph'
import type { SessionCore } from './session-core'
import type { OperationContexts } from './operation-contexts'

export interface ChatQuestionFacadeDeps extends Pick<
  ChatServiceGraph,
  'repo' | 'runner' | 'streamRegistry' | 'now'
> {
  db: ChatServiceDeps['db']
  questions: QuestionRegistry | undefined
  requireSession: SessionCore['requireSession']
  wakes: OperationContexts['wakes']
}

/** A refused close, as the route answers it: gone 404, already decided 409, answered nothing 400. */
function refuse(result: Extract<QuestionResolveResult, { ok: false }>): never {
  if (result.reason === 'already_resolved')
    throw new ApiError(409, 'question_resolved', 'This question was already answered or skipped')
  if (result.reason === 'empty')
    throw new ApiError(400, 'answer_empty', 'The answer names none of the questions asked')
  throw new ApiError(404, 'question_not_found', 'No open question with that id')
}

/** How the card reads once the question closed — the `ask` item's details, whole. */
function closedDetails(record: QuestionRecord): AskToolDetails {
  return {
    // Carried whole: a call that recalled its question by `from` has none in its input.
    questions: record.questions,
    queued: {
      questionId: record.displayId,
      status: record.status,
      ...(record.resolvedAt ? { answeredAt: record.resolvedAt } : {}),
    },
    ...(record.answers ? { answers: record.answers } : {}),
  }
}

export function createChatQuestionFacade(deps: ChatQuestionFacadeDeps) {
  const { db, repo, runner, streamRegistry, now, questions, requireSession, wakes } = deps

  const registry = (): QuestionRegistry => {
    if (!questions) throw new ApiError(503, 'questions_unavailable', 'Questions are not available')
    return questions
  }

  /**
   * Show how the question ended on its card. Through the live run when that run still writes the
   * card's row (`run/live-item.ts`) — a stored-row write would be overwritten by its next flush —
   * else on the stored row, which then has no other writer.
   */
  const settleCard = async (record: QuestionRecord): Promise<void> => {
    const details = closedDetails(record)
    if (runner.patchLiveToolItem(record.toolCallId, { details })) return
    const message = await repo.findActiveBranchToolCallMessage(
      record.userId,
      record.sessionId,
      record.toolCallId,
    )
    const items = message?.payload.items
    if (!message || !items) return
    const patched = items.map((item) =>
      isToolCallItem(item) && item.toolCallId === record.toolCallId
        ? { ...item, output: details }
        : item,
    )
    const updatedAt = now()
    const written = await repo.updateMessage(
      record.userId,
      record.sessionId,
      message.id,
      { items: patched },
      updatedAt,
    )
    publishMessageSnapshot({
      streamRegistry,
      userId: record.userId,
      sessionId: record.sessionId,
      messageId: message.id,
      payload: written?.payload ?? { ...message.payload, items: patched },
      createdAt: message.createdAt,
      updatedAt,
    })
  }

  /**
   * Hand an answer to the agent that asked, ONCE EVER: the wake row and its receipt are written
   * together (`receipt`), and the receipt is what marks the answer delivered. The row was closed
   * first — that is what decides between two tabs — so a wake that never lands (the process died
   * in between, or the store failed) would otherwise lose an answer the person saw accepted. The
   * recovery sweep (`redeliverAnswers`) re-sends every answer without a receipt, and the receipt
   * makes a re-send that races a slow first one the same delivery.
   */
  const deliverAnswer = (record: QuestionRecord): void =>
    wakes.send(
      {
        userId: record.userId,
        sessionId: record.sessionId,
        content: queuedAnswerText(record.displayId, record.questions, record.answers ?? []),
        source: 'answer',
        to: { participant: agentParticipant(record.agentId) },
        deliveryKey: answerDeliveryKey(record),
        receipt: true,
      },
      `answer to ${record.displayId}`,
      (outcome) => {
        // A session that cannot take a wake will not take it on a retry either: decided, done.
        if (outcome.status === 'missed')
          void recordDecidedDelivery(db, {
            deliveryKey: answerDeliveryKey(record),
            userId: record.userId,
            sessionId: record.sessionId,
          }).catch(() => undefined)
        // A store failure leaves no receipt: the minute sweep (`bootstrap/ops-timers.ts`) re-sends.
      },
    )

  /** Every recorded answer whose wake was never admitted, re-sent — the minute recovery sweep. */
  const redeliverAnswers = async (): Promise<number> => {
    if (!questions) return 0
    const stranded = await questions.undeliveredAnswers(receiptHorizon(Date.now()))
    for (const record of stranded) deliverAnswer(record)
    return stranded.length
  }

  return {
    /** The session's open questions, oldest first. */
    async listSessionQuestions(userId: string, sessionId: string) {
      await requireSession(userId, sessionId)
      return sessionQuestions(questions, userId, sessionId)
    },

    /** The person answered one; the registry holds the answer to the question's own options. */
    async answerQuestion(
      userId: string,
      sessionId: string,
      questionId: string,
      submitted: AskToolAnswer[],
    ): Promise<{ ok: true }> {
      await requireSession(userId, sessionId)
      const result = await registry().answer({ userId, sessionId }, questionId, submitted)
      if (!result.ok) refuse(result)
      return { ok: true }
    },

    /** The person declined to answer one. */
    async skipQuestion(
      userId: string,
      sessionId: string,
      questionId: string,
    ): Promise<{ ok: true }> {
      await requireSession(userId, sessionId)
      const result = await registry().skip({ userId, sessionId }, questionId)
      if (!result.ok) refuse(result)
      return { ok: true }
    },

    /**
     * The consequence of any close. Wired once, to the registry's `onResolved`. Only an answer
     * wakes the agent: a skip is told in its next prompt (`takeSkipped`) rather than costing a
     * turn, and a superseded question was the agent's own doing.
     */
    async settleQuestion(record: QuestionRecord): Promise<void> {
      if (record.status === 'answered') deliverAnswer(record)
      await settleCard(record)
    },

    redeliverAnswers,

    /**
     * The active branch moved (an edit, a rollback, a branch switch): a question whose `ask` call
     * is no longer on it belongs to a conversation that is not this one any more. Left open, it
     * stayed in the strip and the prompt, and answering it woke the agent about a question its
     * history no longer holds. Closed as superseded — the person and the agent both moved on —
     * and no wake. Only what was asked before `since`: a run the move started may have just
     * asked, and its call is not on disk yet.
     */
    async reconcileQuestions(
      this: void,
      userId: string,
      sessionId: string,
      since: string,
    ): Promise<void> {
      if (!questions) return
      const owner = { userId, sessionId }
      for (const record of questions.list(owner)) {
        if (record.askedAt >= since) continue
        const onBranch = await repo.findActiveBranchToolCallMessage(
          userId,
          sessionId,
          record.toolCallId,
        )
        if (!onBranch) await questions.supersede(owner, record.displayId)
      }
    },
  }
}
