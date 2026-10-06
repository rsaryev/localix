/** The composer cycles through a short turn-budget scale on each press. */
import { Button } from '@localixai/kit/button'
import { ActionTooltip } from '@localixai/kit/tooltip'
import {
  clampMaxTurns,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MAX_TURNS_STEPS,
} from '@localixai/api/turn-budget'

/** The ceiling reads as no limit rather than a numeric budget. */
export function maxTurnsLabel(value: number): string {
  const turns = clampMaxTurns(value)
  return turns >= MAX_MAX_TURNS ? '∞' : String(turns)
}

export function MaxTurnsControl({
  value,
  onChange,
  disabled,
}: {
  /** The stored cap, or undefined when the person has never set one. */
  value: number | undefined
  onChange: (next: number) => void
  disabled?: boolean
}) {
  const current = clampMaxTurns(value ?? DEFAULT_MAX_TURNS)
  // Preserve custom stored limits until clicked, then advance to the next higher preset.
  const next = MAX_TURNS_STEPS.find((step) => step > current) ?? MAX_TURNS_STEPS[0]
  const currentLabel = current >= MAX_MAX_TURNS ? 'no limit' : String(current)
  const nextLabel = next >= MAX_MAX_TURNS ? 'no limit' : String(next)
  const hint = `Turns per message: ${currentLabel}. Click to set ${nextLabel}`

  return (
    <ActionTooltip side="top" label={hint}>
      <Button
        variant="ghost"
        size="default"
        disabled={disabled}
        aria-label={hint}
        onClick={() => onChange(next)}
        className="px-1.5 text-2xs font-normal text-text-soft hover:text-text-strong"
      >
        <span className="min-w-[3ch] text-center tabular-nums">{maxTurnsLabel(current)}</span>
      </Button>
    </ActionTooltip>
  )
}
