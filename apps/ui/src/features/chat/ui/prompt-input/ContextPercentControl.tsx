import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import {
  CONTEXT_PERCENT_STEPS,
  clampContextPercent,
  DEFAULT_CONTEXT_PERCENT,
} from '@localixai/agent'
import { SETTING_TRIGGER_CLASS } from './model-select/settingTrigger'

export const contextPercentLabel = (value: number) => `${clampContextPercent(value)}%`

/** Share of the model's context window a run may fill before a checkpoint trims its history. */
export function ContextPercentControl({
  value,
  onChange,
  disabled,
}: {
  value: number | undefined
  onChange: (next: number | undefined) => void
  disabled?: boolean
}) {
  const current = clampContextPercent(value)
  const options = [...new Set([...CONTEXT_PERCENT_STEPS, current])].sort((a, b) => a - b)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Context window used: ${contextPercentLabel(current)}`}
          className={SETTING_TRIGGER_CLASS}
        >
          <span className="min-w-0 truncate">{contextPercentLabel(current)}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuEntries
          family="dropdown"
          entries={[
            {
              id: 'default',
              label: 'Use default',
              hint: contextPercentLabel(DEFAULT_CONTEXT_PERCENT),
              selected: value === undefined,
              onSelect: () => onChange(undefined),
            },
            ...options.map((step) => ({
              id: String(step),
              label: contextPercentLabel(step),
              selected: value !== undefined && current === step,
              onSelect: () => onChange(step),
            })),
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
