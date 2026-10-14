import { useEffect, useRef, useState } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { useSettingsStore } from '@/features/settings/model/settingsStore'
import { TextAction } from '@localixai/kit/text-action'
import { ONBOARDING_STEPS } from '../model/steps'
import {
  clearOnboardingStep,
  loadOnboardingFurthest,
  loadOnboardingStep,
  saveOnboardingFurthest,
  saveOnboardingStep,
} from '../model/onboardingProgress'
import { StepRail } from './wizard/StepRail'
import { MobileStepBar } from './wizard/MobileStepBar'
import { useStepFocus } from './wizard/useStepFocus'
import { useFocusEntry } from '@localixai/plugin-sdk/ui/focus'

/** Registry order as persisted ids — see `onboardingProgress` for why not indexes. */
const STEP_IDS = ONBOARDING_STEPS.map((s) => s.id)

/**
 * The onboarding wizard — a full-screen SPLIT page. A progress rail on the left
 * (vertical step list; collapses to a top bar below `lg`) and the active step in a
 * vertically-centered content column on the right. Each step owns its own primary
 * action; the wizard only adds the "skip" affordance. `onExit` is called when the
 * wizard finishes or is skipped (after marking onboarding complete).
 */
export function OnboardingWizard({ onExit }: { onExit: () => void }) {
  const updateSettings = useSettingsStore((s) => s.update)

  // Restore the step a full-page reload (notably an OAuth provider redirect)
  // left off on, so the user resumes instead of starting over. See onboardingProgress.
  const [stepIndex, setStepIndex] = useState(() => loadOnboardingStep(STEP_IDS))
  // The furthest step reached — steps up to here have been SEEN, so the rail lets
  // you jump back AND forward among them freely; only never-visited steps stay
  // locked. Without this, stepping back (Escape) would re-lock the forward steps
  // and force re-advancing one action at a time. It only ever GROWS, and the sole
  // step-forward path is `next()`, so it's bumped there (no derived-state effect).
  const [furthestStep, setFurthestStep] = useState(() => loadOnboardingFurthest(STEP_IDS))
  const stepContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const id = STEP_IDS[stepIndex]
    if (id) saveOnboardingStep(id)
  }, [stepIndex])

  useEffect(() => {
    const id = STEP_IDS[furthestStep]
    if (id) saveOnboardingFurthest(id)
  }, [furthestStep])

  // Clamp so a registry change can never index past the list and blank the page.
  const step = ONBOARDING_STEPS[Math.min(stepIndex, ONBOARDING_STEPS.length - 1)]
  const isLast = stepIndex >= ONBOARDING_STEPS.length - 1
  const isWelcome = stepIndex === 0

  const finish = () => {
    clearOnboardingStep() // don't let "Replay setup" resume mid-wizard later
    const ui = useSettingsStore.getState().settings.uiSettings
    updateSettings({ uiSettings: { ...ui, onboardingCompletedAt: new Date().toISOString() } })
    onExit()
  }
  const next = () => {
    const n = Math.min(stepIndex + 1, ONBOARDING_STEPS.length - 1)
    setStepIndex(n)
    setFurthestStep((f) => Math.max(f, n))
  }
  const back = () => setStepIndex((i) => Math.max(i - 1, 0))
  const handleComplete = () => (isLast ? finish() : next())
  // A step may send the user back to an ALREADY-VISITED step by id (the final
  // activation summary uses it to reopen Provider). Same gate the rail uses, so
  // a step can never teleport past setup the user hasn't seen.
  const jumpTo = (stepId: string) => {
    const i = ONBOARDING_STEPS.findIndex((s) => s.id === stepId)
    if (i >= 0 && i <= furthestStep) setStepIndex(i)
  }

  useStepFocus(stepIndex, stepContentRef)

  // Escape steps BACK (non-destructive — never aborts setup; that's "Skip"). Claimed through the
  // focus stack so a dialog opened from inside a step keeps its own Escape.
  useFocusEntry({
    id: 'onboarding-wizard',
    kind: 'surface',
    onKeyDown: (event) => {
      if (event.key !== 'Escape' || stepIndex === 0) return
      event.preventDefault()
      back()
      return true
    },
  })

  if (!step) return null

  // A wide step hosts the workspace model browser, whose provider/workload/details
  // chrome alone claims ~760px — inside the reading-width column and the rail's
  // symmetric side padding the model list was left ~230px on a 1280px screen.
  // Wide steps therefore get near-full bleed (mirroring the chat model drawer's
  // `min(1440px,98vw)`) and drop the big side padding, keeping only enough right
  // pad to clear the fixed rail. Narrow steps keep the reading measure.
  const colMax = step.wide ? 'max-w-[min(1440px,96vw)]' : 'max-w-2xl'
  const pad = step.wide
    ? 'px-6 py-10 sm:px-10 lg:px-10 lg:py-12 lg:pr-16'
    : 'px-6 py-12 sm:px-10 lg:px-36 lg:py-16'

  return (
    <div className="relative flex h-dvh w-full flex-col overflow-hidden bg-background">
      <MobileStepBar
        steps={ONBOARDING_STEPS}
        stepIndex={stepIndex}
        furthestStep={furthestStep}
        onJump={(i) => i <= furthestStep && setStepIndex(i)}
        onBack={back}
      />

      <div aria-live="polite" aria-atomic="true" className="sr-only">
        Step {stepIndex + 1} of {ONBOARDING_STEPS.length}: {step.title}
      </div>

      {/* Centered content — the step sits in the true center of the viewport; the
          progress rail is a slim right-edge overlay so nothing pushes it off-axis. */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <div className={cn('flex min-h-full items-center justify-center', pad)}>
          <div
            key={step.id}
            ref={stepContentRef}
            tabIndex={-1}
            className={cn('flex w-full flex-col outline-none', colMax)}
            style={{ animation: 'fade-up var(--dur-moderate) var(--ease-emphasized) both' }}
          >
            <step.Component onComplete={handleComplete} onSkip={finish} onJumpTo={jumpTo} />

            {/* The terminal step IS the exit — it owns its own finish actions, so a
                "skip this step" link there would just be a second, vaguer Finish. */}
            {!isLast && (
              <TextAction
                onClick={isWelcome ? finish : handleComplete}
                className="mt-8 self-center text-xs font-medium tracking-wide text-text-faint hover:text-text-soft"
              >
                {isWelcome ? 'Skip setup for now' : 'Skip this step'}
              </TextAction>
            )}
          </div>
        </div>
      </div>

      <StepRail
        steps={ONBOARDING_STEPS}
        stepIndex={stepIndex}
        furthestStep={furthestStep}
        onJump={(i) => i <= furthestStep && setStepIndex(i)}
        compact={step.wide}
      />
    </div>
  )
}
