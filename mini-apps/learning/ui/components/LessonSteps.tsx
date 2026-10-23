import { useState } from 'react'
import { Check, Eye, LockKeyhole } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { CodeBlock } from '@localixai/kit/code-block'
import { MarkdownRenderer } from '@localixai/kit/markdown'
import { SectionLabel } from '@localixai/kit/section-label'
import type {
  FlashcardsStep,
  LessonStep,
  StepAssessment,
  StepEvidence,
} from '../../shared/contracts'
import { stepStage, stepTitle } from '../../shared/progression'
import { QuizStepView, type QuizPosition } from './QuizStepView'
import { PracticeStepView } from './PracticeStepView'

const stageLabel = { theory: 'Theory', test: 'Test', practice: 'Practice' }

function normalizedHeading(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[`*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase()
}

/** Standalone theory files often repeat the title supplied by the reader. */
export function withoutDuplicateLeadingHeading(markdown: string, title: string): string {
  const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*(?:\r?\n|$)/.exec(markdown)
  return heading && normalizedHeading(heading[1] ?? '') === normalizedHeading(title)
    ? markdown.slice(heading[0].length).replace(/^\s*\r?\n/, '')
    : markdown
}

export function LessonStepRail({
  steps,
  activeStepId,
  completedStepIds,
  unlockedStepIds,
  onSelect,
}: {
  steps: LessonStep[]
  activeStepId: string
  completedStepIds: ReadonlySet<string>
  unlockedStepIds: ReadonlySet<string>
  onSelect: (id: string) => void
}) {
  const quizzes = steps.filter((step) => step.type === 'quiz')
  return (
    <nav
      aria-label="Lesson steps"
      className="scrollbar-none flex min-h-[var(--chrome-control-touch)] shrink-0 overflow-x-auto border-b border-border-soft px-3"
    >
      {steps.map((step, index) => {
        const active = step.id === activeStepId
        const unlocked = unlockedStepIds.has(step.id)
        const quizIndex = quizzes.findIndex((item) => item.id === step.id)
        return (
          <Button
            key={step.id}
            type="button"
            variant="ghost"
            aria-current={active ? 'step' : undefined}
            disabled={!unlocked}
            className={cn(
              'relative h-auto min-w-28 shrink-0 justify-start gap-2 rounded-none px-3 py-2 text-left',
              active
                ? 'text-foreground'
                : 'text-text-faint hover:bg-surface-hover hover:text-text-soft',
              !unlocked && 'cursor-not-allowed opacity-50',
            )}
            onClick={() => onSelect(step.id)}
          >
            <span className="flex w-4 shrink-0 items-center justify-center text-2xs tabular-nums">
              {completedStepIds.has(step.id) ? (
                <Check className="size-3 text-status-success" aria-label="Completed" />
              ) : unlocked ? (
                String(index + 1).padStart(2, '0')
              ) : (
                <LockKeyhole className="size-3" aria-label="Locked" />
              )}
            </span>
            <span className="min-w-0">
              <span className="block text-2xs font-medium">
                {quizIndex >= 0 && quizzes.length > 1
                  ? `Test ${quizIndex + 1} of ${quizzes.length}`
                  : stageLabel[stepStage(step)]}
              </span>
              <span className="block max-w-36 truncate text-2xs">{stepTitle(step)}</span>
            </span>
            {active && (
              <span
                className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary"
                aria-hidden="true"
              />
            )}
          </Button>
        )
      })}
    </nav>
  )
}

function FlashcardsStepView({
  step,
  onReady,
}: {
  step: FlashcardsStep
  onReady?: (ready: boolean) => void
}) {
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [recalled, setRecalled] = useState<Set<number>>(new Set())
  const card = step.cards[index]!
  return (
    <section>
      <SectionLabel className="mb-3">Active recall</SectionLabel>
      <h2 className="text-xl font-semibold tracking-tight text-balance">{step.title}</h2>
      <p className="mt-2 text-xs text-text-faint">
        Recall the answer before revealing it. Mark each card once you can explain it.
      </p>
      <div className="mt-5 space-y-4 rounded-lg border border-border-soft p-4">
        <span className="text-2xs tabular-nums text-text-faint">
          Card {index + 1} of {step.cards.length} · {recalled.size} recalled
        </span>
        <MarkdownRenderer>{card.front}</MarkdownRenderer>
        {flipped ? (
          <div className="border-t border-border-soft pt-4">
            <MarkdownRenderer>{card.back}</MarkdownRenderer>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-expanded={flipped}
            onClick={() => setFlipped(!flipped)}
          >
            <Eye aria-hidden="true" />
            {flipped ? 'Hide answer' : 'Show answer'}
          </Button>
          {flipped && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={recalled.has(index)}
              onClick={() => {
                const next = new Set(recalled).add(index)
                setRecalled(next)
                onReady?.(next.size === step.cards.length)
              }}
            >
              <Check aria-hidden="true" />I recalled this
            </Button>
          )}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1" aria-label="Flashcard navigation">
        {step.cards.map((_, cardIndex) => (
          <Button
            key={cardIndex}
            type="button"
            size="sm"
            variant={cardIndex === index ? 'secondary' : 'ghost'}
            aria-label={`Flashcard ${cardIndex + 1}`}
            aria-current={cardIndex === index}
            onClick={() => {
              setIndex(cardIndex)
              setFlipped(false)
            }}
          >
            {cardIndex + 1}
            {recalled.has(cardIndex) && <Check aria-hidden="true" />}
          </Button>
        ))}
      </div>
    </section>
  )
}

export function LessonStepView({
  step,
  onAnswer,
  quizPosition,
  assessment,
  onSubmitAnswer,
  onSubmitPractice,
  onRecallReady,
}: {
  step: LessonStep
  onAnswer: (id: string, correct: boolean) => void
  quizPosition?: QuizPosition
  assessment?: StepAssessment
  onSubmitAnswer?: (id: string, evidence: StepEvidence) => Promise<void>
  onSubmitPractice?: (id: string, response: string) => Promise<void>
  onRecallReady?: (ready: boolean) => void
}) {
  if (step.type === 'quiz')
    return (
      <QuizStepView
        step={step}
        onAnswer={onAnswer}
        onSubmit={onSubmitAnswer}
        assessment={assessment}
        position={quizPosition}
      />
    )
  if (step.type === 'practice')
    return <PracticeStepView step={step} assessment={assessment} onSubmit={onSubmitPractice} />
  if (step.type === 'flashcards') return <FlashcardsStepView step={step} onReady={onRecallReady} />
  return (
    <section>
      <SectionLabel className="mb-3">Theory</SectionLabel>
      <h2 className="text-xl font-semibold tracking-tight text-balance">{step.title}</h2>
      {step.type === 'concept' ? (
        <>
          <div className="mt-4 text-sm/7 text-text-soft">
            <MarkdownRenderer>
              {withoutDuplicateLeadingHeading(step.body, step.title)}
            </MarkdownRenderer>
          </div>
          {step.keyPoints?.length ? (
            <div className="mt-6 space-y-3">
              <SectionLabel>Key ideas</SectionLabel>
              <ul className="list-disc space-y-2 pl-5 text-sm/6 text-text-soft">
                {step.keyPoints.map((point) => (
                  <li key={point}>
                    <MarkdownRenderer>{point}</MarkdownRenderer>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : step.type === 'code' ? (
        <>
          <CodeBlock code={step.code} language={step.language} className="mt-5" />
          {step.explanation && (
            <div className="mt-4 text-sm/7 text-text-soft">
              <MarkdownRenderer>{step.explanation}</MarkdownRenderer>
            </div>
          )}
        </>
      ) : (
        <ol className="mt-5 space-y-5">
          {step.steps.map((item, index) => (
            <li key={item.label} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-3">
              <span className="pt-0.5 text-2xs tabular-nums text-text-faint">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <strong className="block text-sm font-medium">{item.label}</strong>
                <div className="mt-2 text-sm/6 text-text-soft">
                  <MarkdownRenderer>{item.detail}</MarkdownRenderer>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
