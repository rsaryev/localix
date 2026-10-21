import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { DEFAULT_MAX_TURNS } from '@localixai/api/turn-budget'
import { SETTING_TRIGGER_CLASS } from './model-select/settingTrigger'
import { maxTurnsChoices, maxTurnsLabel } from './model-select/modelSettingChoices'

export { maxTurnsLabel }

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
  const { current, options } = maxTurnsChoices(value, inherited, limit)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Turns per message: ${maxTurnsLabel(current)}`}
          className={SETTING_TRIGGER_CLASS}
        >
          <span className="min-w-0 truncate">{maxTurnsLabel(current)}</span>
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
