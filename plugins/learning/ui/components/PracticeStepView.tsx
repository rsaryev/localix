import { useId, useState } from 'react'
import { Check, Lightbulb, Send } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { SectionLabel } from '@localixai/kit/section-label'
import { Textarea } from '@localixai/kit/textarea'
import type { PracticeStep, StepAssessment } from '../../shared/contracts'

export function PracticeStepView({
  step,
  assessment,
  onSubmit,
}: {
  step: PracticeStep
  assessment?: StepAssessment
  onSubmit?: (stepId: string, response: string) => Promise<void>
}) {
  const [hint, setHint] = useState(false)
  const [response, setResponse] = useState(assessment?.response ?? '')
  const [saving, setSaving] = useState(false)
  const responseId = useId()
  const waiting =
    assessment?.status === 'submitted' && Date.now() - Date.parse(assessment.updatedAt) < 5 * 60_000
  const send = async () => {
    if (!onSubmit || saving || waiting || !response.trim()) return
    setSaving(true)
    try {
      await onSubmit(step.id, response)
    } catch {
      /* The workspace owns the problem line. */
    } finally {
      setSaving(false)
    }
  }
  return (
    <section>
      <SectionLabel className="mb-3">Practice</SectionLabel>
      <h2 className="text-xl font-semibold tracking-tight text-balance">{step.title}</h2>
      <div className="mt-3 text-sm/7 text-text-soft">
        <MarkdownRenderer>{step.prompt}</MarkdownRenderer>
      </div>
      <div className="mt-6">
        <SectionLabel className="mb-3">What your solution should demonstrate</SectionLabel>
        <ul className="space-y-2 text-sm/6 text-text-soft">
          {step.acceptanceCriteria.map((criterion) => (
            <li key={criterion} className="flex items-start gap-2">
              <Check className="mt-1 size-3.5 shrink-0 text-text-faint" aria-hidden="true" />
              <span className="min-w-0">
                <MarkdownRenderer>{criterion}</MarkdownRenderer>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {step.hint && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-4"
          aria-expanded={hint}
          onClick={() => setHint((value) => !value)}
        >
          <Lightbulb aria-hidden="true" />
          {hint ? 'Hide hint' : 'Show hint'}
        </Button>
      )}
      {hint && (
        <div className="mt-3 border-l-2 border-border pl-4 text-sm/6 text-text-soft">
          <MarkdownRenderer>{step.hint ?? ''}</MarkdownRenderer>
        </div>
      )}
      {onSubmit && (
        <div className="mt-8 space-y-3">
          <label htmlFor={responseId} className="block text-sm font-medium">
            Your solution
          </label>
          <Textarea
            id={responseId}
            value={response}
            onChange={(event) => setResponse(event.target.value)}
            disabled={saving || waiting || assessment?.passed}
            maxLength={20_000}
            rows={7}
            placeholder="Explain your reasoning, paste your code, or describe the result you verified."
            className="resize-y font-mono text-sm"
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs/5 text-text-faint">
              The tutor checks your solution against the criteria above.
            </p>
            <Button
              type="button"
              size="sm"
              className="min-w-40"
              disabled={!response.trim() || saving || waiting || assessment?.passed}
              onClick={() => void send()}
            >
              <Send aria-hidden="true" />
              {saving
                ? 'Submitting…'
                : waiting
                  ? 'Awaiting review…'
                  : assessment?.status === 'reviewed'
                    ? 'Submit revision'
                    : 'Check my solution'}
            </Button>
          </div>
        </div>
      )}
      {waiting && (
        <p role="status" className="mt-5 text-sm text-text-soft">
          Your solution is saved. The tutor will review it in this course’s conversation.
        </p>
      )}
      {assessment?.feedback && (
        <div role="status" className="mt-6 space-y-3 border-t border-border-soft pt-5">
          <SectionLabel>
            {assessment.status === 'unreachable'
              ? 'Review unavailable'
              : assessment.passed
                ? 'Practice passed'
                : 'Revise your solution'}
          </SectionLabel>
          <MarkdownRenderer>{assessment.feedback}</MarkdownRenderer>
        </div>
      )}
    </section>
  )
}
