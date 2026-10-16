/**
 * A LINE TYPED WHILE AN `ask` CARD IS OPEN ANSWERS THE CARD.
 *
 * `ask` blocks its run until the person answers, and the run takes nothing from the queue while a
 * card is pending (`run/steering.ts`), so a message typed into the composer instead of the card
 * used to wait behind the very question it was answering — and then open a second turn of its
 * own once the card expired. Here it becomes the card's free-form answer: every question in the
 * card gets the typed text as its custom answer, the run resumes with it, and no turn is queued.
 */
import { ApiError } from '../../../lib/errors'
import type { AskToolAnswer, AskToolPayload } from '../../agent-core/tools/hitl/ask'
import type { ChatServiceGraph } from './service-graph'

export type AnswerPendingAsk = (userId: string, sessionId: string, text: string) => boolean

export function createAnswerPendingAsk({
  hitlRegistry,
  streamRegistry,
}: Pick<ChatServiceGraph, 'hitlRegistry' | 'streamRegistry'>): AnswerPendingAsk {
  return (userId, sessionId, text) => {
    const answer = text.trim()
    if (!answer) return false
    const pending = hitlRegistry
      .listPendingInteractions(sessionId)
      .find((interaction) => interaction.kind === 'ask')
    if (!pending) return false
    const questions = (pending.payload as Partial<AskToolPayload> | undefined)?.questions ?? []
    if (questions.length === 0) return false
    const answers: AskToolAnswer[] = questions.map((question) => ({
      id: question.id,
      question: question.question,
      selectedOptions: [],
      customInput: answer,
    }))
    try {
      hitlRegistry.respond(pending.requestId, answers, userId)
    } catch (error) {
      // Answered, expired or released a moment ago: the line is an ordinary message after all.
      if (error instanceof ApiError) return false
      throw error
    }
    streamRegistry.publish(userId, sessionId, {
      type: 'hitl.resolved',
      sessionId,
      requestId: pending.requestId,
      reason: 'answered',
    })
    return true
  }
}
