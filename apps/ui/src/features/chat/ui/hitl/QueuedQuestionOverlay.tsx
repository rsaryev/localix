import type { SessionQuestion } from '@/shared/api/contracts'
import { useQuestionUiStore } from '../../model/questionUi'
import { useQuestionActions } from '../../model/useQuestionActions'
import { QueuedQuestionView } from './QueuedQuestionView'

/** Uses the same composer slot as a waiting ask, so only the visible form owns shortcuts. */
export function QueuedQuestionOverlay({
  sessionId,
  question,
  keyboardActive,
}: {
  sessionId: string
  question: SessionQuestion
  keyboardActive: boolean
}) {
  const actions = useQuestionActions(sessionId)
  return (
    <QueuedQuestionView
      key={question.id}
      question={question}
      submitting={actions.submitting}
      keyboardActive={keyboardActive}
      onSubmit={(answers) => void actions.answer(question, answers)}
      onSkip={() => void actions.skip(question)}
      onClose={() => useQuestionUiStore.getState().close(sessionId, question.id)}
    />
  )
}
