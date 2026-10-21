import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { ReasoningEffort } from '../../../model/reasoning'
import { reasoningEntries, resolveReasoningPick } from './reasoningEntries'
import { SETTING_TRIGGER_CLASS } from './settingTrigger'

interface ModelReasoningMenuProps {
  modelLabel: string
  /** The levels this model publishes (`CatalogModel.reasoningEfforts`); absent = full scale. */
  reasoningEfforts?: readonly string[]
  /** The level this model holds for the target being configured. */
  value: ReasoningEffort
  onChange: (effort: ReasoningEffort) => void
}

/**
 * The reasoning level as the app's own menu — `DropdownMenu` drawn by the shared `MenuEntries`
 * walker. A menu is modal (the list beneath takes no hover or click while it is open), so the
 * hover-driven details panel cannot switch models under an open choice.
 */
export function ModelReasoningMenu({
  modelLabel,
  reasoningEfforts,
  value,
  onChange,
}: ModelReasoningMenuProps) {
  const pick = { reasoningEfforts, value }
  const { resolvedLabel } = resolveReasoningPick(pick)
  const entries = reasoningEntries({ ...pick, onChange })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reasoning for ${modelLabel}: ${resolvedLabel}`}
          className={SETTING_TRIGGER_CLASS}
        >
          <span className="min-w-0 truncate">{resolvedLabel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
