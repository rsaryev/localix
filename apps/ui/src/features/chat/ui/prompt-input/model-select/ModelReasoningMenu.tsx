import { ChevronDown } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { ReasoningEffort } from '../../../model/reasoning'
import { reasoningEntries, resolveReasoningPick } from './reasoningEntries'

interface ModelReasoningMenuProps {
  modelLabel: string
  /** The levels this model publishes (`CatalogModel.reasoningEfforts`); absent = full scale. */
  reasoningEfforts?: readonly string[]
  /** This model's own level, or undefined when it follows the inherited one. */
  value: ReasoningEffort | undefined
  /** The level a model with no level of its own runs at (the session's), when there is one. */
  inheritedEffort?: ReasoningEffort
  onChange: (effort: ReasoningEffort | undefined) => void
}

/**
 * The reasoning level as the app's own menu — `DropdownMenu` drawn by the shared `MenuEntries`
 * walker, the same rows, check column and hints as every other menu here.
 *
 * WHY THIS SHAPE. It was a bespoke popover on the model row first: it floated over the list, the
 * rows under it highlighted and could be clicked — picking another model on the way to a level —
 * and its portal made the hover-driven details panel collapse under the pointer. Then segments in
 * the panel: six levels in a 230px column truncated to "Mi…", "M…", "X-…". A menu is MODAL (the
 * list beneath takes no hover or click while it is open), lists every level at full width with
 * what it means, and is the one menu the rest of the app already uses.
 *
 * The rows come from `reasoningEntries`, the builder the composer's chip uses too, so the two
 * pickers cannot word or mark the same choice differently.
 */
export function ModelReasoningMenu({
  modelLabel,
  reasoningEfforts,
  value,
  inheritedEffort,
  onChange,
}: ModelReasoningMenuProps) {
  const pick = { reasoningEfforts, value, inheritedEffort }
  const { inherits, resolvedLabel } = resolveReasoningPick(pick)
  const entries = reasoningEntries({ ...pick, onChange })

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Reasoning for ${modelLabel}: ${resolvedLabel}`}
          // Quiet text, no outline: the settings row already frames it, and a bordered field
          // there was a second frame that read as noise. Hover and open take the shared veils.
          className="-mr-1.5 inline-flex h-(--chrome-control-md) min-w-0 items-center gap-1 rounded-md px-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-surface-hover focus-ring aria-expanded:bg-surface-active"
        >
          <span className="min-w-0 truncate">
            {inherits ? `Session · ${resolvedLabel}` : resolvedLabel}
          </span>
          <ChevronDown className="size-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
