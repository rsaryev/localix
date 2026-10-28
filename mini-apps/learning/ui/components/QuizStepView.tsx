import { useRef, useState } from 'react'
import { Check, RotateCcw } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { SectionLabel } from '@localixai/kit/section-label'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { QuizStep, StepAssessment, StepEvidence } from '../../shared/contracts'
import { quizOptions } from '../../shared/quiz-options'

export interface QuizPosition {
  current: number
  total: number
}

export function QuizStepView({
  step,
  onAnswer,
  onSubmit,
  assessment,
  position,
}: {
  step: QuizStep
  onAnswer: (stepId: string, correct: boolean) => void
  onSubmit?: (stepId: string, evidence: StepEvidence) => Promise<void>
  assessment?: StepAssessment
  position?: QuizPosition
}) {
  const [selected, setSelected] = useState<string | null>(assessment?.selectedOptionId ?? null)
  const [saving, setSaving] = useState(false)
  const firstOption = useRef<HTMLButtonElement>(null)
  const correct = selected === step.correctOptionId
  const choose = async (optionId: string) => {
    if (selected || saving) return
    setSaving(true)
    try {
      if (onSubmit) await onSubmit(step.id, { optionId })
      setSelected(optionId)
      onAnswer(step.id, optionId === step.correctOptionId)
    } catch {
      // The workspace publishes the failure and keeps this question retryable.
    } finally {
      setSaving(false)
    }
  }
  return (
    <section aria-busy={saving}>
      <div className="mb-3 flex items-center justify-between gap-4">
        <SectionLabel>Test</SectionLabel>
        {position && (
          <span className="text-2xs tabular-nums text-text-faint">
            Question {position.current} of {position.total}
          </span>
        )}
      </div>
      <div className="text-xl font-semibold tracking-tight text-balance">
        <MarkdownRenderer>{step.question}</MarkdownRenderer>
      </div>
      <div className="mt-6 grid gap-2" role="group" aria-label="Answer options">
        {quizOptions(step).map((option, index) => {
          const picked = selected === option.id
          return (
            <Button
              key={option.id}
              ref={index === 0 ? firstOption : undefined}
              type="button"
              variant="ghost"
              disabled={selected !== null || saving}
              aria-pressed={picked}
              className={cn(
                'h-auto min-h-[var(--chrome-control-touch)] w-full items-start justify-start gap-3 whitespace-normal px-4 py-3 text-left font-normal',
                picked &&
                  correct &&
                  'border-status-success/40 bg-status-success/8 text-status-success disabled:opacity-100',
                picked &&
                  !correct &&
                  'border-status-error/45 bg-status-error/8 text-status-error disabled:opacity-100',
              )}
              onClick={() => void choose(option.id)}
            >
              <span className="flex size-5 shrink-0 items-center justify-center rounded-md bg-surface-hover text-2xs font-semibold text-text-faint">
                {String.fromCharCode(65 + index)}
              </span>
              <span className="min-w-0 flex-1">
                <MarkdownRenderer>{option.label}</MarkdownRenderer>
              </span>
              {picked && correct && <Check className="mt-0.5 size-3.5" aria-hidden="true" />}
            </Button>
          )
        })}
      </div>
      {selected && (
        <div
          role="status"
          className={cn(
            'mt-5 space-y-3 border-l-2 py-1 pl-4 text-sm/6 text-text-soft',
            correct ? 'border-status-success' : 'border-status-error',
          )}
        >
          <strong className="font-medium text-foreground">
            {correct ? 'Correct.' : 'Try another answer.'}
          </strong>
          {correct ? (
            <MarkdownRenderer>{step.explanation}</MarkdownRenderer>
          ) : (
            <>
              <p>
                Revisit the theory and consider what distinguishes the options before trying again.
              </p>
              <Button
                type="button"
                variant="mono"
                size="sm"
                onClick={() => {
                  setSelected(null)
                  window.requestAnimationFrame(() => firstOption.current?.focus())
                }}
              >
                <RotateCcw aria-hidden="true" /> Try again
              </Button>
            </>
          )}
          {assessment && (
            <p className="text-2xs tabular-nums text-text-faint">
              {assessment.attempts} {assessment.attempts === 1 ? 'attempt' : 'attempts'} · First
              attempt {assessment.firstCorrect ? 'correct' : 'needs review'}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
