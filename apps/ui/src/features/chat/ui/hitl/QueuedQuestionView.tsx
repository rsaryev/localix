import { useRef } from 'react'
import type { AskToolAnswer } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import type { SessionQuestion } from '@/shared/api/contracts'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import { useAskForm } from './AskQuestionForm'

interface QueuedQuestionViewProps {
  question: SessionQuestion
  submitting: boolean
  keyboardActive?: boolean
  onSubmit: (answers: AskToolAnswer[]) => void
  /** Decline to answer: the question closes and the agent is told. */
  onSkip: () => void
  /** Put it away unanswered — it stays open in the strip. */
  onClose: () => void
}

/**
 * A QUEUED ask — a question the agent left for later (`ask` with `wait: false`).
 *
 * Nothing is waiting on it, so its card says three things a blocking card must not: there is no
 * deadline (no countdown, nothing auto-denies), closing it is not refusing it (✕ and Esc put it
 * back in the strip, still open), and refusing is SKIP — not Deny, because there is no request
 * to deny, only a question the person chose not to answer. The answering itself is the same form
 * as a blocking ask's (`AskQuestionForm.tsx`).
 */
export function QueuedQuestionView({
  question,
  submitting,
  keyboardActive = true,
  onSubmit,
  onSkip,
  onClose,
}: QueuedQuestionViewProps) {
  const questions = question.questions
  const frameRef = useRef<HTMLDivElement>(null)
  const form = useAskForm({ questions, submitting, keyboardActive, onSubmit, rootRef: frameRef })

  if (!form.activeQuestion) return null

  return (
    <HitlInteractionFrame
      title={`The agent asked · ${question.id}`}
      detail={
        questions.length > 1
          ? `${form.answeredCount}/${questions.length} answered · no rush, the agent keeps working`
          : 'No rush — the agent keeps working and picks up your answer when you send it'
      }
      progress={questions.length > 1 ? `${form.activeIndex + 1}/${questions.length}` : undefined}
      onDismiss={onClose}
      dismissLabel="Answer later"
      dismissDisabled={submitting}
      onSubmit={form.onEnter}
      keyboardActive={keyboardActive}
      rootRef={frameRef}
      footer={
        <>
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={onClose}
            className="mr-auto text-text-soft hover:bg-surface-hover"
          >
            Answer later
            <Kbd>esc</Kbd>
          </Button>
          <Button
            variant="ghost"
            size="lg"
            disabled={submitting}
            onClick={onSkip}
            className="text-text-soft hover:bg-surface-hover"
          >
            Skip
          </Button>
          {questions.length > 1 && (
            <Button
              variant="ghost"
              size="lg"
              className="text-text-soft hover:bg-surface-hover"
              disabled={form.activeIndex === 0 || submitting}
              onClick={form.back}
            >
              Back
            </Button>
          )}
          {form.isLastQuestion ? (
            <Button
              variant="mono"
              size="lg"
              disabled={!form.canSubmit || submitting}
              onClick={form.submit}
            >
              Send answer
              <Kbd className="border-background/30 text-background/70">↵</Kbd>
            </Button>
          ) : (
            <Button
              variant="mono"
              size="lg"
              disabled={!form.currentAnswered || submitting}
              onClick={form.next}
            >
              Next
              <Kbd className="border-background/30 text-background/70">↵</Kbd>
            </Button>
          )}
        </>
      }
    >
      {form.body}
    </HitlInteractionFrame>
  )
}
