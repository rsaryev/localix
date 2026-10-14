import { useRef } from 'react'
import type { AskToolAnswer } from '@localixai/api/client'
import { Button } from '@localixai/kit/button'
import { Kbd } from '@localixai/kit/kbd'
import type { PendingAskInteraction } from '../../model/agent-runtime'
import { HitlInteractionFrame } from './HitlInteractionFrame'
import type { HitlFrameChrome } from './HitlInteractionFrame'
import { useAskForm } from './AskQuestionForm'

interface AskInteractionViewProps {
  interaction: PendingAskInteraction
  submitting: boolean
  keyboardActive?: boolean
  onSubmit: (requestId: string, answers: AskToolAnswer[]) => void
  onDismiss: (requestId: string) => void
  onDefer?: (requestId: string) => void
  /** Which shell renders this view — the chat transcript, or the cross-session inbox dialog. */
  chrome?: HitlFrameChrome
}

/** A BLOCKING ask: a run is waiting on this decision, so it carries the deadline and Deny. */
export function AskInteractionView({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  onDefer,
  chrome,
}: AskInteractionViewProps) {
  const payload = interaction.request.payload
  const questions = payload.questions
  const defer = payload.canDefer && onDefer ? () => onDefer(interaction.request.id) : undefined
  const frameRef = useRef<HTMLDivElement>(null)
  const form = useAskForm({
    compact: chrome === 'compact',
    questions,
    submitting,
    keyboardActive,
    rootRef: frameRef,
    onSubmit: (answers) => onSubmit(interaction.request.id, answers),
  })

  if (!form.activeQuestion) return null

  return (
    <HitlInteractionFrame
      chrome={chrome}
      title={interaction.request.title ?? payload.loading_messages[0] ?? 'Waiting for your input'}
      detail={
        questions.length > 1
          ? `${form.answeredCount}/${questions.length} answered`
          : 'The agent needs a decision to continue'
      }
      expiresAt={interaction.request.expiresAt}
      progress={questions.length > 1 ? `${form.activeIndex + 1}/${questions.length}` : undefined}
      onDismiss={() => {
        if (submitting) return
        if (defer) defer()
        else onDismiss(interaction.request.id)
      }}
      dismissLabel={defer ? 'Answer later' : 'Deny'}
      dismissDisabled={submitting}
      onSubmit={form.onEnter}
      keyboardActive={keyboardActive}
      rootRef={frameRef}
      footer={
        <>
          {defer && (
            <Button
              variant="ghost"
              size={chrome === 'compact' ? 'default' : 'lg'}
              disabled={submitting}
              onClick={defer}
              className="text-text-soft hover:bg-surface-hover"
            >
              Answer later
              <Kbd>esc</Kbd>
            </Button>
          )}
          <Button
            variant="ghost"
            size={chrome === 'compact' ? 'default' : 'lg'}
            disabled={submitting}
            onClick={() => onDismiss(interaction.request.id)}
            className="text-text-soft hover:bg-surface-hover"
          >
            Deny
            {!defer && <Kbd>esc</Kbd>}
          </Button>
          {questions.length > 1 && (
            <Button
              variant="ghost"
              size={chrome === 'compact' ? 'default' : 'lg'}
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
              size={chrome === 'compact' ? 'default' : 'lg'}
              disabled={!form.canSubmit || submitting}
              onClick={form.submit}
            >
              Approve
              <Kbd className="border-background/30 text-background/70">↵</Kbd>
            </Button>
          ) : (
            <Button
              variant="mono"
              size={chrome === 'compact' ? 'default' : 'lg'}
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
