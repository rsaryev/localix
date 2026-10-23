import { ChevronDown, ListFilter, X } from 'lucide-react'
import type { IconComponent, MenuEntry, MenuSubmenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

/**
 * "Filter ▾" — every narrowing of one list behind ONE quiet trigger.
 *
 * The defect it replaces: each list drew its narrowings as a row of framed `Select` fields — three
 * in the event journal's popover, two in the Vault toolbar, four in the usage dashboard. A form
 * field per dimension is a form where nothing is saved, each one wide enough to show its value and
 * so all of them crowding a narrow pane, and each list sized them differently. A filter is a pick
 * (a pick is a menu, not a form), so it is the app's menu: one row per dimension whose
 * `hint` is the current answer, opening onto that dimension's options as `selected` rows. A choice
 * is `keepOpen` and steps back to the dimensions, so the new answer shows in the row it was made
 * from and a second dimension is one move away.
 *
 * A long option list (every model the ledger has seen) scrolls inside its submenu — the kit caps a
 * submenu at the room Radix measures — so there is no search primitive here.
 */

/** One option of a dimension. The first one of a facet is conventionally its "all" answer. */
export interface FilterOption<V extends string = string> {
  value: V
  label: string
  icon?: IconComponent
  description?: string
}

/** One dimension the list can be narrowed by. */
export interface FilterFacet<V extends string = string> {
  id: string
  label: string
  icon?: IconComponent
  value: V
  /** The value that narrows nothing; a facet off it counts as active. */
  allValue: V
  options: readonly FilterOption<V>[]
  // A method, so a facet over a narrower union still fits a list of `FilterFacet<string>`.
  onChange(value: V): void
}

/** A facet as one submenu row of the filter menu. */
export function filterFacetEntry<V extends string>(facet: FilterFacet<V>): MenuSubmenuEntry {
  const current = facet.options.find((option) => option.value === facet.value)
  return {
    id: facet.id,
    label: facet.label,
    icon: facet.icon,
    // A value the options no longer list (a filter set from a breakdown row) still reads as set.
    hint: current?.label ?? facet.value,
    items: facet.options.map((option) => ({
      id: `${facet.id}:${option.value}`,
      label: option.label,
      icon: option.icon,
      description: option.description,
      selected: option.value === facet.value,
      keepOpen: true,
      onSelect: () => {
        if (option.value !== facet.value) facet.onChange(option.value)
      },
    })),
  }
}

/** How many facets narrow the list right now. */
export function activeFacetCount(facets: readonly FilterFacet<string>[]): number {
  return facets.filter((facet) => facet.value !== facet.allValue).length
}

export function FilterMenu({
  facets,
  label = 'Filter',
  align = 'end',
  className,
}: {
  facets: readonly FilterFacet<string>[]
  /** The trigger's name and the menu's accessible subject, e.g. "Filter events". */
  label?: string
  align?: 'start' | 'end'
  className?: string
}) {
  const active = activeFacetCount(facets)
  const entries: MenuEntry[] = [
    ...facets.map((facet) => filterFacetEntry(facet)),
    ...(active > 0
      ? [
          { separator: true } as const,
          {
            id: 'clear',
            label: 'Clear filters',
            icon: X,
            onSelect: () => {
              for (const facet of facets) {
                if (facet.value !== facet.allValue) facet.onChange(facet.allValue)
              }
            },
          },
        ]
      : []),
  ]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={active > 0 ? `${label}: ${active} active` : label}
          aria-pressed={active > 0}
          className={className}
        >
          <ListFilter data-icon="inline-start" aria-hidden />
          {active > 0 ? `Filter · ${active}` : 'Filter'}
          <ChevronDown data-icon="inline-end" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
