import { useCallback, useId, useMemo, useState } from 'react'
import { Check, CheckCircle2 } from 'lucide-react'
import type { AskToolAnswer, AskToolQuestion } from '@localixai/api/client'
import { Input } from '@localixai/kit/input'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'
import { isTypingTarget } from '@/shared/lib/keybindings/typingTarget'
import { hitlFrameOwnsGlobalKeyboard } from './HitlInteractionFrame'
import { nextEnterAction } from './hitlKeys'
import { optionValue } from './options'

/**
 * THE FORM OF AN `ask` — stepping through its questions, choosing, typing a custom answer —
 * independent of what the answer is for.
 *
 * Two cards render it. A BLOCKING ask is a decision a run is waiting on (`AskInteractionView`:
 * Deny / Approve, a deadline). A QUEUED ask is a question the agent left for later
 * (`QueuedQuestionView`: Skip / Send, no deadline, closing it keeps it open). They differ in
 * their frame and their footer, never in how a question is answered, so the answering lives once,
 * here — two copies would let a fix to one (the number keys, a long label's wrapping) miss the
 * other.
 */
export function useAskForm({
  questions,
  submitting,
  keyboardActive,
  onSubmit,
}: {
  questions: AskToolQuestion[]
  submitting: boolean
  keyboardActive: boolean
  onSubmit: (answers: AskToolAnswer[]) => void
}) {
  const instanceId = useId()
  const [activeIndex, setActiveIndex] = useState(0)
  const [selected, setSelected] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      questions.map((question) => [
        question.id,
        question.recommended !== undefined && question.options[question.recommended]
          ? [optionValue(question.options[question.recommended])]
          : [],
      ]),
    ),
  )
  const [custom, setCustom] = useState<Record<string, string>>({})

  const activeQuestion = questions[Math.min(activeIndex, Math.max(questions.length - 1, 0))]
  const isLastQuestion = activeIndex >= questions.length - 1
  const answeredCount = useMemo(
    () =>
      questions.filter((question) => {
        const hasSelection = (selected[question.id] ?? []).length > 0
        const hasCustom = Boolean(custom[question.id]?.trim())
        return hasSelection || hasCustom
      }).length,
    [custom, questions, selected],
  )
  const currentAnswered = Boolean(
    activeQuestion &&
    ((selected[activeQuestion.id] ?? []).length > 0 || custom[activeQuestion.id]?.trim()),
  )
  const canSubmit = answeredCount === questions.length

  const toggleOption = useCallback((questionId: string, value: string, multi?: boolean) => {
    setSelected((current) => {
      const values = current[questionId] ?? []
      if (!multi) return { ...current, [questionId]: [value] }
      return {
        ...current,
        [questionId]: values.includes(value)
          ? values.filter((item) => item !== value)
          : [...values, value],
      }
    })
  }, [])

  // The option badges show 1, 2, 3… — make those keys actually select, so the
  // current question can be answered without reaching for the mouse. Ignored while
  // a custom answer is being typed (so digits land in the input) or with modifiers.
  useFocusEntry({
    // Per instance: a blocking card and a queued question's card can be open at once, and only
    // the one that owns the keyboard may take a digit.
    id: `hitl-ask-options:${instanceId}`,
    kind: 'surface',
    active: keyboardActive,
    onKeyDown: (event) => {
      if (
        !hitlFrameOwnsGlobalKeyboard(keyboardActive) ||
        !activeQuestion ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey
      )
        return
      if (isTypingTarget(document.activeElement)) return
      if (event.key < '1' || event.key > '9') return
      const option = activeQuestion.options?.[Number(event.key) - 1]
      if (!option) return
      event.preventDefault()
      toggleOption(activeQuestion.id, optionValue(option), activeQuestion.multi)
      return true
    },
  })

  const submit = () => {
    if (!canSubmit || submitting) return
    onSubmit(
      questions.map((question) => ({
        id: question.id,
        question: question.question,
        selectedOptions: selected[question.id] ?? [],
        ...(custom[question.id]?.trim() ? { customInput: custom[question.id].trim() } : {}),
      })),
    )
  }
  const next = () => setActiveIndex((index) => Math.min(questions.length - 1, index + 1))
  const back = () => setActiveIndex((index) => Math.max(0, index - 1))

  // Enter steps through / submits the stepped form (see nextEnterAction). Always a handler, a
  // no-op while submitting: an absent one let the key fall through the focus stack to whatever
  // card lay underneath — a queued question's Enter could approve the blocking card below it.
  const onEnter = () => {
    if (submitting) return
    const action = nextEnterAction({ currentAnswered, canSubmit, isLast: isLastQuestion })
    if (action === 'submit') submit()
    else if (action === 'next') next()
  }

  const body = activeQuestion ? (
    <AskQuestionFields
      question={activeQuestion}
      selected={selected[activeQuestion.id] ?? []}
      custom={custom[activeQuestion.id] ?? ''}
      onToggle={(value) => toggleOption(activeQuestion.id, value, activeQuestion.multi)}
      onCustom={(value) => setCustom((current) => ({ ...current, [activeQuestion.id]: value }))}
    />
  ) : null

  return {
    activeIndex,
    activeQuestion,
    isLastQuestion,
    answeredCount,
    currentAnswered,
    canSubmit,
    submit,
    next,
    back,
    onEnter,
    body,
  }
}

function AskQuestionFields({
  question: activeQuestion,
  selected,
  custom,
  onToggle,
  onCustom,
}: {
  question: AskToolQuestion
  selected: string[]
  custom: string
  onToggle: (value: string) => void
  onCustom: (value: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="min-w-0 text-sm font-medium leading-snug wrap-anywhere text-foreground">
        {activeQuestion.question}
      </div>

      <div
        className="grid gap-1.5"
        role="group"
        aria-label={`Answers for ${activeQuestion.question}`}
      >
        {(activeQuestion.options ?? []).map((option, optionIndex) => {
          const value = optionValue(option)
          const active = selected.includes(value)
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              aria-keyshortcuts={optionIndex < 9 ? String(optionIndex + 1) : undefined}
              className={[
                // `min-w-0`: a grid item's default `min-width: auto` refuses to shrink below its
                // content, so one long option label widened the whole column past the dialog.
                'focus-ring flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2.5 py-2 text-left text-sm transition-colors',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-surface-hover text-text-strong hover:bg-surface-active hover:text-foreground',
              ].join(' ')}
              onClick={() => onToggle(value)}
            >
              <span
                aria-hidden="true"
                className={[
                  'flex size-5 shrink-0 items-center justify-center rounded-md text-2xs font-medium',
                  active ? 'bg-background/14' : 'bg-surface-active text-text-soft',
                ].join(' ')}
              >
                {active ? <Check className="size-3" /> : optionIndex + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug wrap-anywhere">{option.label}</span>
                {option.description && (
                  <span className="mt-0.5 block text-xs wrap-anywhere opacity-70">
                    {option.description}
                  </span>
                )}
              </span>
              {activeQuestion.recommended === optionIndex && (
                <span className="flex shrink-0 items-center gap-1 text-2xs opacity-75">
                  <CheckCircle2 className="size-3" aria-hidden="true" />
                  Recommended
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* A custom free-text answer is always offered, on every question. */}
      <Input
        size="xl"
        value={custom}
        onChange={(event) => onCustom(event.target.value)}
        placeholder="Or type a custom answer…"
        aria-label={`Custom answer for ${activeQuestion.question}`}
      />
    </div>
  )
}
