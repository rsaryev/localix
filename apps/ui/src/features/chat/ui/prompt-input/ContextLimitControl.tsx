import { ChevronDown } from 'lucide-react'
import type { ContextLimit } from '@localixai/agent'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { SETTING_TRIGGER_CLASS } from './model-select/settingTrigger'
import { contextLimitOptions } from './model-select/modelSettingChoices'

/**
 * How many tokens a run may hold before a checkpoint trims its history — offered per model from
 * its own window, the way the reasoning menu offers that model's levels.
 */
export function ContextLimitControl({
  contextWindow,
  value,
  onChange,
  disabled,
}: {
  contextWindow: number | undefined
  value: ContextLimit | undefined
  onChange: (next: ContextLimit | undefined) => void
  disabled?: boolean
}) {
  const { options, selected } = contextLimitOptions(contextWindow, value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Context limit: ${selected.label}`}
          className={SETTING_TRIGGER_CLASS}
        >
          <span className="min-w-0 truncate">{selected.label}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <MenuEntries
          family="dropdown"
          entries={options.map((option) => ({
            id: option.arg,
            label: option.label,
            selected: option.value === selected.value,
            onSelect: () => onChange(option.value),
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
