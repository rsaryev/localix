import { ChevronLeft } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { OnboardingStep } from '../../model/types'

/**
 * The narrow-width top bar — shown below `lg` in place of `StepRail`. A back
 * affordance on the left, then the current step's name (unlabelled dots alone
 * stopped telling you where you were once the flow grew past three steps), and a
 * progress-dot row on the right (every VISITED dot up to `furthestStep` jumps to
 * it — back or forward; the current step is a pill; unvisited steps are locked).
 * Driven by the same `ONBOARDING_STEPS`/`stepIndex`/`furthestStep` as the rail.
 */
export function MobileStepBar({
  steps,
  stepIndex,
  furthestStep,
  onJump,
  onBack,
}: {
  steps: OnboardingStep[]
  stepIndex: number
  furthestStep: number
  onJump: (index: number) => void
  onBack: () => void
}) {
  return (
    <header className="flex h-[var(--mobile-header-height)] shrink-0 items-center justify-between gap-4 px-6 sm:px-10 lg:hidden">
      <div className="flex size-[var(--chrome-control-md)] items-center justify-center">
        {stepIndex > 0 && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back"
            className="flex size-[var(--chrome-control-md)] items-center justify-center rounded-full text-text-faint transition-colors hover:bg-surface-hover hover:text-text-strong"
            style={{ animation: 'fade-in var(--dur-moderate) var(--ease-soft) both' }}
          >
            <ChevronLeft className="size-5" />
          </button>
        )}
      </div>

      <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-soft">
        {steps[stepIndex]?.title}
      </span>

      <nav className="flex items-center gap-1.5" role="group" aria-label="Setup progress">
        {steps.map((s, i) => {
          if (i !== stepIndex && i <= furthestStep) {
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => onJump(i)}
                aria-label={`Go to ${s.title}`}
                title={s.title}
                className="h-1.5 w-1.5 rounded-full bg-foreground/40 outline-none transition-[width,background-color] duration-(--dur-moderate) hover:w-3 hover:bg-foreground/70 focus-ring"
              />
            )
          }
          return (
            <span
              key={s.id}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color] duration-(--dur-moderate)',
                i === stepIndex ? 'w-6 bg-foreground' : 'w-1.5 bg-foreground/15',
              )}
            />
          )
        })}
      </nav>
    </header>
  )
}
