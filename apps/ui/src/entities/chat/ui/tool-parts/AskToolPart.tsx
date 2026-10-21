import { MessageSquare } from 'lucide-react'
import type { ToolCallItem } from '@localixai/agent/agents'
import type { AskToolDetails, AskToolInput, AskToolQuestion } from '@localixai/api/client'
import { ToolLine } from './ToolLine'
import { hasItemError, isItemDeclined, isItemStreaming } from './itemHelpers'

// ---- Helpers -------------------------------------------------------------------

function optionLabel(question: AskToolQuestion, value: string): string {
  return question.options.find((o) => (o.value ?? o.label) === value)?.label ?? value
}

function selectedSummary(question: AskToolQuestion, selectedValues: string[]): string {
  if (selectedValues.length === 0) return '—'
  return selectedValues.map((v) => optionLabel(question, v)).join(', ')
}

// Single answer row in the expanded view
function AnswerRow({
  question,
  selectedOptions,
  customInput,
}: {
  question: AskToolQuestion
  selectedOptions: string[]
  customInput?: string
}) {
  const pills = selectedOptions.map((v) => optionLabel(question, v))
  if (customInput?.trim()) pills.push(customInput.trim())

  return (
    <div className="space-y-1">
      <div className="text-2xs leading-tight text-text-faint">{question.question}</div>
      {pills.length > 0 ? (
        <p className="text-2xs leading-relaxed text-text-soft">{pills.join(', ')}</p>
      ) : (
        <span className="text-2xs text-text-faint">No answer given</span>
      )}
    </div>
  )
}

// ---- Main component ------------------------------------------------------------

export function AskToolPart({ item }: { item: ToolCallItem }) {
  const input = item.input as AskToolInput | undefined
  const output = item.output as AskToolDetails | undefined
  const isLoading = isItemStreaming(item)
  const hasError = hasItemError(item)
  // An expired question is nobody's error: it renders neutral, with "No one answered…".
  const expired = Boolean(output?.expired)
  // Skip is a choice the person made, not a failure: also neutral.
  const skipped = Boolean((output as { skipped?: boolean } | undefined)?.skipped)
  const unanswered = expired || skipped || isItemDeclined(item)
  const isDismissed = item.error?.kind === 'dismissed' || item.error?.kind === 'aborted'

  const questions = input?.questions ?? output?.request?.payload.questions ?? []
  const answers = output?.answers ?? []
  const firstQuestion = questions[0]
  const firstAnswer = answers.find((a) => a.id === firstQuestion?.id)

  // Build the subtitle shown in the collapsed header.
  const subtitle = (() => {
    if (isLoading) return input?.loading_messages?.[0] ?? 'Waiting for your input…'
    if (expired) return 'No one answered in 5 minutes — the agent went on'
    if (skipped) return 'Skipped — the agent went on without an answer'
    if (isDismissed) return 'Dismissed — no answer sent'
    if (hasError || unanswered)
      return item.error?.personMessage ?? item.error?.userMessage ?? 'An error occurred'
    if (firstAnswer && firstQuestion) {
      const summary = selectedSummary(firstQuestion, firstAnswer.selectedOptions)
      const extra = firstAnswer.customInput?.trim()
      return extra ? `${summary} — ${extra}` : summary
    }
    return undefined
  })()

  const badge =
    questions.length > 1 ? (
      <span className="text-2xs text-text-faint">{questions.length}</span>
    ) : null

  // Only show expanded content when we have something to show.
  const hasExpandedContent = !isLoading && questions.length > 0 && (answers.length > 0 || hasError)

  return (
    <ToolLine
      icon={MessageSquare}
      title={firstQuestion?.question ?? 'Question'}
      subtitle={subtitle}
      badge={badge}
      isLoading={isLoading}
      hasError={hasError && !isDismissed}
      isDismissed={isDismissed || unanswered}
      // Follow-mode: collapsed while awaiting input (the overlay carries the
      // interaction); a real failure opens the card and stays open. Init-only
      // `defaultOpen` missed errors that arrived after mount.
      autoOpen={hasError && !isDismissed}
    >
      {hasExpandedContent ? (
        <div className="space-y-2.5 py-1.5">
          {questions.map((question) => {
            const answer = answers.find((a) => a.id === question.id)
            return (
              <AnswerRow
                key={question.id}
                question={question}
                selectedOptions={answer?.selectedOptions ?? []}
                customInput={answer?.customInput}
              />
            )
          })}
          {isDismissed && (
            <p className="text-2xs text-text-faint">
              The interaction was cancelled before an answer was submitted.
            </p>
          )}
          {hasError && !isDismissed && item.error?.message && (
            <p className="text-2xs text-status-error">
              {item.error.personMessage ?? item.error.message}
            </p>
          )}
        </div>
      ) : null}
    </ToolLine>
  )
}
