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
  /** Which shell renders this view — the chat transcript, or the cross-session inbox dialog. */
  chrome?: HitlFrameChrome
}

/** The server's fallback title for an untitled request ("ask needs input") names a tool, not a person. */
const GENERIC_TITLE = /^\S+ needs input$/

/**
 * An ask: the agent's question, not a permission. A run waits on it, so it carries the deadline,
 * but its words are a conversation's: **Send** answers, **Skip** (Esc) tells the agent the person
 * skipped it, and silence lets the agent continue without an answer. A line typed in the composer
 * while it is open answers it too, as a custom answer (server `composer-ask-answer`).
 */
export function AskInteractionView({
  interaction,
  submitting,
  keyboardActive = true,
  onSubmit,
  onDismiss,
  chrome,
}: AskInteractionViewProps) {
  const payload = interaction.request.payload
  const questions = payload.questions
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
      title={askTitle(interaction.request.title)}
      detail={
        questions.length > 1
          ? `${form.answeredCount}/${questions.length} answered`
          : 'The agent needs your answer to continue'
      }
      expiresAt={interaction.request.expiresAt}
      expiryOutcome="continue"
      progress={questions.length > 1 ? `${form.activeIndex + 1}/${questions.length}` : undefined}
      onDismiss={() => {
        if (!submitting) onDismiss(interaction.request.id)
      }}
      dismissLabel="Skip this question"
      dismissDisabled={submitting}
      onSubmit={form.onEnter}
      keyboardActive={keyboardActive}
      rootRef={frameRef}
      footer={
        <>
          <Button
            variant="ghost"
            size={chrome === 'compact' ? 'default' : 'lg'}
            disabled={submitting}
            onClick={() => onDismiss(interaction.request.id)}
            className="text-text-soft hover:bg-surface-hover"
          >
            Skip
            <Kbd>esc</Kbd>
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
              Send
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

/** A specific title the agent gave wins; the tool-named fallback becomes a person's sentence. */
export function askTitle(title: string | undefined): string {
  const trimmed = title?.trim()
  if (!trimmed || GENERIC_TITLE.test(trimmed)) return 'The agent asks'
  return trimmed.replace(/: \S+ needs input$/, ': the agent asks')
}
