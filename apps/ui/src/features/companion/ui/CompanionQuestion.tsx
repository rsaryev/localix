import { useEffect, useState } from 'react'
import type { AskToolAnswer, AttentionItem } from '@localixai/api/client'
import type { SessionQuestion, UiSession } from '@/shared/api/contracts'
import { backendClient } from '@/shared/api/client'
import { Button } from '@localixai/kit/button'
import { LoadingHint } from '@localixai/kit/empty-hint'
import { QueuedQuestionView } from '@/features/chat/ui/hitl/QueuedQuestionView'
import { useQuestionActions } from '@/features/chat/model/useQuestionActions'

export default function CompanionQuestion({
  item,
  session,
  onClose,
  onOpen,
  onResolved,
  keyboardActive,
}: {
  item: AttentionItem
  session: UiSession | undefined
  onClose: () => void
  onOpen: () => void
  onResolved: () => void
  keyboardActive: boolean
}) {
  const [question, setQuestion] = useState<SessionQuestion | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const actions = useQuestionActions(item.sessionId)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setError(null)
    void backendClient
      .getSession(item.sessionId)
      .then((detail) => {
        if (!alive) return
        const found = detail.questions?.find((entry) => entry.id === item.subject.displayId)
        setQuestion(found ?? null)
        if (!found) setError('This question is no longer waiting for an answer.')
      })
      .catch(() => {
        if (alive) setError('Could not load the question.')
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [item.sessionId, item.subject.displayId, attempt])

  const submit = async (answers?: AskToolAnswer[]) => {
    if (!question) return
    const settled = answers ? await actions.answer(question, answers) : await actions.skip(question)
    if (settled) onResolved()
  }

  return (
    <section aria-label="Queued question">
      <header className="flex items-center justify-between gap-2 border-b border-border-soft px-3 py-2">
        <h2 className="truncate text-2xs font-medium">
          {session?.title || 'Background conversation'}
        </h2>
        <Button variant="ghost" size="xs" onClick={onOpen}>
          Open chat
        </Button>
      </header>
      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-status-error">
          {error}
        </p>
      )}
      {loading ? (
        <LoadingHint>Opening question…</LoadingHint>
      ) : question ? (
        <QueuedQuestionView
          question={question}
          submitting={actions.submitting}
          keyboardActive={keyboardActive}
          chrome="compact"
          onSubmit={(answers) => void submit(answers)}
          onSkip={() => void submit()}
          onClose={onClose}
        />
      ) : (
        <div className="flex justify-end gap-2 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Back
          </Button>
          <Button variant="field" size="sm" onClick={() => setAttempt((value) => value + 1)}>
            Retry
          </Button>
        </div>
      )}
    </section>
  )
}
