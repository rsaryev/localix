import { ListFilter } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { ActionTooltip } from '@localixai/kit/tooltip'
import type { ModelFilter } from './filterModels'
import { MODEL_FILTER_ORDER } from './filterModels'

/**
 * What each facet means, shown under its name. It sat in a native `title` before, which only a
 * pointer resting on the row ever saw — and "Caching" alone does not say it is about price.
 */
const FILTER_META: Record<ModelFilter, { label: string; description: string }> = {
  tools: { label: 'Tools', description: 'Supports tool calling' },
  reasoning: { label: 'Reasoning', description: 'Supports reasoning / thinking' },
  vision: { label: 'Vision', description: 'Accepts image input' },
  caching: { label: 'Caching', description: 'Provider prices prompt caching' },
  free: { label: 'Free', description: 'No token cost' },
}

/**
 * Capability filters for the model list, as one icon menu on the search band.
 *
 * WHY A MENU. The facets used to be a strip of their own under the search field: a third band
 * of chrome in the model column that the provider rail beside it did not have, so the column's
 * divider ran lower than its neighbour's, and its toggles kept a hidden check in front of each
 * label, which put their text on yet another vertical. One trigger on the search band keeps the
 * column on the shared two-band measure; the pressed state and the tooltip say a filter is on,
 * and the header's count says what it hides.
 *
 * Only the facets that apply to the current list are offered (`available`); nothing renders
 * when there is nothing to filter by.
 */
export function ModelFilterMenu({
  available,
  active,
  onToggle,
  onClear,
}: {
  available: ModelFilter[]
  active: ModelFilter[]
  onToggle: (filter: ModelFilter) => void
  onClear: () => void
}) {
  if (available.length === 0) return null
  const offered = MODEL_FILTER_ORDER.filter((f) => available.includes(f))
  const summary =
    active.length > 0
      ? `Filtered: ${offered
          .filter((f) => active.includes(f))
          .map((f) => FILTER_META[f].label)
          .join(', ')}`
      : 'Filter models'
  const entries: MenuEntry[] = [
    { header: 'Show models with' },
    ...offered.map((f) => ({
      id: f,
      label: FILTER_META[f].label,
      description: FILTER_META[f].description,
      // Facets combine, so each row is a toggle (`checked`, not `selected`), and a pick keeps
      // the menu open for the next one.
      checked: active.includes(f),
      keepOpen: true,
      onSelect: () => onToggle(f),
    })),
    ...(active.length > 0
      ? [{ separator: true } as const, { id: 'clear', label: 'Clear filters', onSelect: onClear }]
      : []),
  ]
  return (
    <DropdownMenu>
      <ActionTooltip label={summary} side="bottom">
        <DropdownMenuTrigger asChild>
          <IconButton
            size="md"
            aria-label={summary}
            aria-pressed={active.length > 0}
            // Enter on the trigger opens the menu; it must not also reach cmdk through the
            // shared Command root and pick whichever model is highlighted.
            onKeyDown={(event) => event.stopPropagation()}
          >
            <ListFilter />
          </IconButton>
        </DropdownMenuTrigger>
      </ActionTooltip>
      <DropdownMenuContent align="end" className="w-60">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
