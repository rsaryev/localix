import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { OnboardingStep } from '../../model/types'

/**
 * The progress indicator — a slim, scroll-like rail pinned to the RIGHT edge and
 * vertically centered, so the step content stays centered in the viewport. Each
 * step is a short tick (a scrollbar-style segment); the current one widens and
 * brightens and shows its label and one-line description; others reveal
 * their label on hover. Every
 * VISITED tick (up to `furthestStep`) is clickable — jump back OR forward among
 * steps you've already seen; only never-visited steps stay locked. Driven by
 * `ONBOARDING_STEPS`/`stepIndex`/`furthestStep`; hidden below `lg` — narrow
 * widths get `MobileStepBar`.
 */
export function StepRail({
  steps,
  stepIndex,
  furthestStep,
  onJump,
  compact,
}: {
  steps: OnboardingStep[]
  stepIndex: number
  furthestStep: number
  onJump: (index: number) => void
  /**
   * Ticks only, labels on hover — for a WIDE step, whose content runs under the
   * rail. A persistent label there printed itself over the model browser's edge,
   * and reserving room for it would cost the width that step exists to have. The
   * hover label carries its own backdrop so it stays readable over content.
   */
  compact?: boolean
}) {
  return (
    <aside
      className="pointer-events-none fixed inset-y-0 right-0 z-(--z-raised) hidden items-center pr-6 lg:flex"
      aria-label="Setup progress"
    >
      <ol className="flex flex-col items-end gap-2">
        {steps.map((s, i) => {
          // `done` = any visited step other than the current one (before OR after
          // it, thanks to furthestStep); `current` = active; `upcoming` = locked.
          const state = i === stepIndex ? 'current' : i <= furthestStep ? 'done' : 'upcoming'
          const clickable = i <= furthestStep && i !== stepIndex
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => clickable && onJump(i)}
                disabled={!clickable}
                aria-current={state === 'current' ? 'step' : undefined}
                title={s.title}
                className={cn(
                  'group flex items-center justify-end gap-3 py-1 outline-none focus-ring',
                  !clickable && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'pointer-events-none flex items-center gap-2 rounded-md transition-[transform,opacity] duration-(--dur-moderate) ease-(--ease-emphasized) group-hover:pointer-events-auto group-focus-within:pointer-events-auto',
                    // Over a wide step the label floats above content — give it a
                    // ground so it reads as a label, not as overlapping text.
                    compact && 'bg-background/90 px-2 py-1 backdrop-blur-sm',
                    state === 'current' && !compact
                      ? 'pointer-events-auto translate-x-0 opacity-100'
                      : 'translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100',
                  )}
                >
                  <span className="flex flex-col items-end">
                    <span
                      className={cn(
                        'whitespace-nowrap text-xs font-medium transition-colors',
                        state === 'current' ? 'text-text-strong' : 'text-text-soft',
                      )}
                    >
                      {s.title}
                    </span>
                    {/* The one-line "what happens here" — only for the step you're
                        on; on every other tick it would be noise on hover. */}
                    {state === 'current' && !compact && (
                      <span className="whitespace-nowrap text-2xs text-text-faint">
                        {s.description}
                      </span>
                    )}
                  </span>
                </span>
                <span
                  className={cn(
                    'pointer-events-auto h-1.5 shrink-0 rounded-full transition-[width,background-color] duration-(--dur-moderate) ease-(--ease-emphasized)',
                    state === 'current' && 'w-7 bg-foreground',
                    state === 'done' &&
                      'w-3.5 bg-foreground/50 group-hover:w-5 group-hover:bg-foreground/80',
                    state === 'upcoming' && 'w-3.5 bg-foreground/15 group-hover:bg-foreground/25',
                  )}
                />
              </button>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}
