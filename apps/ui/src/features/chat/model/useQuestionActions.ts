import type { AskToolAnswer } from '@localixai/api/client'
import { ApiError, backendClient } from '@/shared/api/client'
import type { SessionQuestion } from '@/shared/api/contracts'
import { toast } from '@/shared/lib/notify'
import { useQuestionUiStore } from './questionUi'

/** One in-flight action per chat, shared by the queue row and the composer form. */
export function useQuestionActions(sessionId: string | null) {
  const submitting = useQuestionUiStore((state) =>
    Boolean(sessionId && state.submittingBySession[sessionId]),
  )
  const settle = async (question: SessionQuestion, act: () => Promise<void>, failure: string) => {
    if (!sessionId || !useQuestionUiStore.getState().begin(sessionId, question.id)) return
    try {
      await act()
      useQuestionUiStore.getState().close(sessionId, question.id)
    } catch (error) {
      // Another tab or a blocking recall already settled it; the next push removes its row.
      if (error instanceof ApiError && (error.status === 404 || error.status === 409))
        useQuestionUiStore.getState().close(sessionId, question.id)
      else toast.error(failure, { description: question.questions[0]?.question })
    } finally {
      useQuestionUiStore.getState().finish(sessionId, question.id)
    }
  }
  return {
    submitting,
    answer: (question: SessionQuestion, answers: AskToolAnswer[]) =>
      settle(
        question,
        () => backendClient.answerQuestion(sessionId!, question.id, answers),
        'Could not send your answer',
      ),
    skip: (question: SessionQuestion) =>
      settle(
        question,
        () => backendClient.skipQuestion(sessionId!, question.id),
        'Could not skip the question',
      ),
  }
}
