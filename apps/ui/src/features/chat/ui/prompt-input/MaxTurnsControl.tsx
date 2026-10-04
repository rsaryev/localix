/**
 * HOW MUCH WORK ONE MESSAGE BUYS — the composer's control for it.
 *
 * It sits beside the reasoning level because it answers the neighbouring question. The reasoning
 * control says how hard the model thinks per reply; this one says how many replies the message
 * is allowed to cost before the run stops on its own. Both are the price of pressing send, so
 * both belong in the same strip rather than in a settings page the person would have to leave
 * the conversation to reach.
 *
 * It writes the same setting the agent runtime reads
 * (`@localixai/api/turn-budget`), so there is one number and not a per-surface copy. Lower it
 * and both stop sooner; leave it alone and nothing anywhere behaves differently.
 *
 * A MENU, not a button that cycles. Cycling walked a thirteen-step scale one press at a time, so
 * going from 20 back to 12 meant pressing through 500, 1000 and the wrap — and a press meant only
 * to see the options changed the setting. The app's own `DropdownMenu` lists every step at once
 * and choosing is a deliberate second click. The trigger stays the quiet readout it was: the
 * icon and the current value.
 */
import { Repeat2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/plugin-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ActionTooltip } from '@localixai/kit/tooltip'
import {
  clampMaxTurns,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MAX_TURNS_STEPS,
} from '@localixai/api/turn-budget'

/**
 * The number as the person reads it.
 *
 * The ceiling is not a count — it is the absence of a cap, and printing "1000" would invite
 * somebody to wonder what happens on the thousand-and-first turn. Nothing does: the run ends
 * when the model stops calling tools.
 */
export function maxTurnsLabel(value: number): string {
  const turns = clampMaxTurns(value)
  return turns >= MAX_MAX_TURNS ? '∞' : String(turns)
}

/**
 * One `selected` row per step. A stored value off the scale (somebody typed 7 into the setting)
 * gets a row of its own in order, so the menu never opens with nothing marked as current.
 */
export function maxTurnsEntries(current: number, onChange: (next: number) => void): MenuEntry[] {
  const steps: number[] = [...MAX_TURNS_STEPS]
  if (!steps.includes(current)) steps.push(current)
  steps.sort((a, b) => a - b)
  return [
    { header: 'Turns per message' },
    ...steps.map((step) => ({
      id: String(step),
      label: maxTurnsLabel(step),
      ...(step >= MAX_MAX_TURNS ? { description: 'Runs until the agent stops' } : {}),
      selected: step === current,
      onSelect: () => {
        if (step !== current) onChange(step)
      },
    })),
  ]
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
  const unlimited = current >= MAX_MAX_TURNS
  return (
    <DropdownMenu>
      {/* The workbench's own hint, not a native `title`: that is the convention the rest of this
          chrome follows (`shared/ui/icon-button.tsx` keeps `title` out of its API on purpose),
          and a strip that mixed the two would show two different tooltips a few pixels apart. */}
      <ActionTooltip
        side="top"
        // One line. The tooltip sits a few pixels above a dense strip, and a heading with a
        // sentence under it is a card — it covers the thing it is describing.
        label={unlimited ? 'Turns per message: no limit' : `Turns per message: ${current}`}
      >
        <DropdownMenuTrigger asChild disabled={disabled}>
          <button
            type="button"
            aria-label={`Turns per message: ${unlimited ? 'no limit' : current}. Change`}
            className="focus-ring inline-flex h-[var(--chrome-control-md)] shrink-0 items-center gap-1 rounded-md px-1.5 text-2xs text-text-soft transition-colors hover:bg-surface-hover hover:text-text-strong aria-expanded:bg-surface-active aria-expanded:text-text-strong disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Repeat2 className="size-3 shrink-0" aria-hidden />
            {/* Tabular figures and a floor on the width: the strip must not jog sideways as the
                number changes width, which it does on almost every step of this scale. */}
            <span className="min-w-[2ch] text-center tabular-nums">{maxTurnsLabel(current)}</span>
          </button>
        </DropdownMenuTrigger>
      </ActionTooltip>
      {/* Above the trigger: the composer sits at the bottom of the window, so a menu opening
          downward lands over the message being written. */}
      <DropdownMenuContent align="end" side="top" className="w-52">
        <MenuEntries entries={maxTurnsEntries(current, onChange)} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
