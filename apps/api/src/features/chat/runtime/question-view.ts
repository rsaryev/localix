/**
 * The composer's view of an open queued question — the one projection the read model, the
 * session list and the `session_questions.updated` push all use, so a reload and a live update
 * cannot disagree about what is open.
 */
import type { OpenQuestionsState } from '../../agent-core/tools/hitl/ask-queue'
import type { QuestionOwner, QuestionRecord } from '../../questions/contracts'
import type { QuestionRegistry } from '../../questions/registry'
import type { SessionQuestion } from '../contracts'

export function toSessionQuestion(record: QuestionRecord): SessionQuestion {
  return {
    id: record.displayId,
    agentId: record.agentId,
    toolCallId: record.toolCallId,
    questions: record.questions,
    askedAt: record.askedAt,
  }
}

/**
 * What the speaker's next prompt says about its questions: its OWN open ones (a colleague's are
 * not its to re-ask), and the ones the person skipped since it last looked — taken here, once.
 */
export function speakerQuestions(
  questions: QuestionRegistry | undefined,
  owner: QuestionOwner,
  agentId: string,
): OpenQuestionsState | undefined {
  if (!questions) return undefined
  return {
    open: questions
      .list(owner)
      .filter((record) => record.agentId === agentId)
      .map((record) => ({
        questionId: record.displayId,
        question: record.questions[0]?.question ?? '',
        count: record.questions.length,
        askedAt: Date.parse(record.askedAt),
      })),
    skipped: questions.takeSkipped(owner, agentId).map((record) => ({
      questionId: record.displayId,
      question: record.questions[0]?.question ?? '',
    })),
  }
}

/** The session's open questions, oldest first. Empty for a host with no registry. */
export const sessionQuestions = (
  questions: QuestionRegistry | undefined,
  userId: string,
  sessionId: string,
): SessionQuestion[] =>
  questions ? questions.list({ userId, sessionId }).map(toSessionQuestion) : []
