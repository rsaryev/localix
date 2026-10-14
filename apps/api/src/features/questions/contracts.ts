/**
 * QUESTIONS THE AGENT ASKED WITHOUT STOPPING TO WAIT.
 *
 * A blocking `ask` holds its run on a promise in memory for five minutes and then gives up: right
 * for a decision the next step cannot be taken without, wrong for a preference that only makes the
 * result better. That kind of question used to be either asked blocking — idling the run on a
 * person who may be away — or not asked at all. A queued question is the third answer: the call
 * returns at once, the agent keeps working, and the person answers whenever they look. Its answer
 * then reaches the agent as a turn of its own, or at the next step of the run already going.
 *
 * That only works if the question outlives everything that can end in between — the turn that
 * asked, the run, the process — so it is a durable row with a lifecycle of its own:
 *
 *   pending     asked, not yet answered;
 *   answered    the person answered; the answer was handed to the agent;
 *   skipped     the person declined to answer; the agent is told at its next turn;
 *   superseded  the agent asked the same question (same id) again, which replaces it.
 */
import type { AskToolAnswer, AskToolQuestion } from '../agent-core/tools/hitl/ask'

export type QuestionStatus = 'pending' | 'answered' | 'skipped' | 'superseded'

export interface QuestionRecord {
  id: string
  userId: string
  sessionId: string
  /** The participant whose run asked — the one its answer wakes. */
  agentId: string
  /** What the agent and the user call it: `q-3`. Never reused within a session. */
  displayId: string
  toolCallId: string
  questions: AskToolQuestion[]
  status: QuestionStatus
  answers: AskToolAnswer[] | null
  askedAt: string
  resolvedAt: string | null
}

export interface QuestionOwner {
  userId: string
  sessionId: string
}

/** The id prefix every queued question carries. */
export const QUESTION_PREFIX = 'q'

/**
 * The once-ever delivery key of a question's answer. Its receipt, written with the wake row, is
 * what marks the answer DELIVERED — the recovery sweep re-sends an answered question without one.
 */
export const ANSWER_DELIVERY_PREFIX = 'question:'
export const answerDeliveryKey = (record: Pick<QuestionRecord, 'id'>) =>
  `${ANSWER_DELIVERY_PREFIX}${record.id}`
