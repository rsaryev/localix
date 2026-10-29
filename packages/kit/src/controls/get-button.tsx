import { forwardRef, type ComponentPropsWithoutRef } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** Where an install stands, as the one control that acts on it shows it. */
export type GetState =
  | { kind: 'get' }
  | { kind: 'progress'; percent: number | null; label: string }
  | { kind: 'open' }
  | { kind: 'update' }
  | { kind: 'retry' }
  | { kind: 'installed' }

const WORDS = { get: 'Get', open: 'Open', update: 'Update', retry: 'Retry' } as const

const PILL =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold tabular-nums select-none'
const SIZE = {
  sm: 'h-(--chrome-control-sm) min-w-14 px-3 text-xs',
  md: 'h-(--chrome-control-md) min-w-16 px-3.5 text-xs',
  lg: 'h-(--chrome-control-lg) min-w-20 px-4 text-sm',
} as const
const TONE = {
  quiet: 'bg-field-fill text-foreground hover:bg-surface-hover active:bg-surface-active',
  strong: 'bg-foreground text-background hover:bg-foreground/90 active:bg-foreground/80',
} as const

/** A ring that fills as the job runs; an open arc that turns while it cannot say how far. */
function Ring({ percent }: { percent: number | null }) {
  const r = 6.5
  const length = 2 * Math.PI * r
  const shown = percent === null ? 0.25 : Math.max(0.04, Math.min(1, percent / 100))
  return (
    <svg
      viewBox="0 0 16 16"
      className={cn('size-4 -rotate-90', percent === null && 'motion-safe:animate-spin')}
      aria-hidden
    >
      <circle cx="8" cy="8" r={r} fill="none" strokeWidth="2" className="stroke-foreground/15" />
      <circle
        cx="8"
        cy="8"
        r={r}
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={`${shown * length} ${length}`}
        className="stroke-current transition-[stroke-dasharray] duration-(--dur-base)"
      />
    </svg>
  )
}

export interface GetButtonProps extends Omit<
  ComponentPropsWithoutRef<'button'>,
  'onClick' | 'children' | 'name'
> {
  state: GetState
  /** What it acts on — "Notes" — so the control is "Get Notes", not one of many "Get"s. */
  name: string
  onPress?: () => void
  size?: keyof typeof SIZE
  /** The page's one primary action is solid; a tile's is a quiet pill. */
  emphasis?: keyof typeof TONE
}

/**
 * THE INSTALL CONTROL of a store, one component for its whole life: Get, then a ring with how far
 * the job is, then Open (installed, with something to open), Update (a newer version is offered)
 * or Retry (it failed). Installed with nothing to open, it says so and is not a button. Each state
 * names its subject for a screen reader, and the progress is a real progressbar.
 */
export const GetButton = forwardRef<HTMLButtonElement, GetButtonProps>(function GetButton(
  { state, name, onPress, size = 'sm', emphasis = 'quiet', className, ...props },
  ref,
) {
  if (state.kind === 'progress')
    return (
      <span
        role="progressbar"
        aria-label={`${state.label} ${name}`}
        aria-valuemin={0}
        aria-valuemax={100}
        {...(state.percent === null ? {} : { 'aria-valuenow': state.percent })}
        className={cn(PILL, SIZE[size], 'bg-field-fill text-text-soft', className)}
      >
        <Ring percent={state.percent} />
        <span>{state.percent === null ? state.label : `${state.percent}%`}</span>
      </span>
    )
  if (state.kind === 'installed')
    return (
      <span className={cn(PILL, SIZE[size], 'text-text-soft', className)}>
        <Check className="size-3.5" aria-hidden />
        Installed
      </span>
    )
  const word = WORDS[state.kind]
  return (
    <button
      ref={ref}
      type="button"
      aria-label={`${word} ${name}`}
      className={cn(
        PILL,
        SIZE[size],
        TONE[emphasis],
        'transition-colors duration-(--dur-fast) focus-ring',
        className,
      )}
      onClick={(event) => {
        event.stopPropagation()
        onPress?.()
      }}
      {...props}
    >
      {word}
    </button>
  )
})
