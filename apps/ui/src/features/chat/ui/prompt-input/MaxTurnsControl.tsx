import { ChevronDown } from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  clampMaxTurns,
  DEFAULT_MAX_TURNS,
  MAX_MAX_TURNS,
  MAX_TURNS_STEPS,
} from '@localixai/api/turn-budget'

export function maxTurnsLabel(value: number): string {
  const turns = clampMaxTurns(value)
  return turns >= MAX_MAX_TURNS ? 'No limit' : String(turns)
}

/** A model setting for the selected participant, with an explicit inherited default. */
export function MaxTurnsControl({
  value,
  inherited = DEFAULT_MAX_TURNS,
  limit,
  onChange,
  disabled,
}: {
  value: number | undefined
  inherited?: number
  limit?: number
  onChange: (next: number | undefined) => void
  disabled?: boolean
}) {
  const ceiling = clampMaxTurns(limit)
  const current = Math.min(clampMaxTurns(value ?? inherited), ceiling)
  const options = [...new Set([...MAX_TURNS_STEPS, current, ceiling])]
    .filter((step) => step <= ceiling)
    .sort((a, b) => a - b)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={`Turns per message: ${maxTurnsLabel(current)}`}
          className="text-text-soft"
        >
          <span>
            {value === undefined ? `Default · ${maxTurnsLabel(current)}` : maxTurnsLabel(current)}
          </span>
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuEntries
          family="dropdown"
          entries={[
            {
              id: 'default',
              label: 'Use default',
              hint: maxTurnsLabel(inherited),
              selected: value === undefined,
              onSelect: () => onChange(undefined),
            },
            ...options.map((step) => ({
              id: String(step),
              label: maxTurnsLabel(step),
              selected: value !== undefined && current === step,
              onSelect: () => onChange(step),
            })),
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
