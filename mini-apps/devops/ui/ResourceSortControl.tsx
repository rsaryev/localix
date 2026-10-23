import { ArrowDown, ArrowUp, ChevronDown } from 'lucide-react'
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { ResourceSort, SortDirection } from './model/resourceSort'

export interface ResourceSortOption<Key extends string> {
  value: Key
  label: string
}

/**
 * HOW THE INVENTORY IS ORDERED — one quiet "Sort" menu, shared by Docker and Kubernetes.
 *
 * It was a framed `Select` for the key and a separate icon button for the direction: a form field
 * in a sidebar header, and one sort spread over two controls whose relation the person had to
 * infer. A sort is one pick with two dimensions, so it is one menu: the keys, then the direction,
 * every row `selected` and `keepOpen` — the person can set both in one visit and see the answer
 * on the rows they just chose. The trigger reads the current key and direction.
 */
export function ResourceSortControl<Key extends string>({
  sort,
  options,
  onChange,
}: {
  sort: ResourceSort<Key>
  options: readonly ResourceSortOption<Key>[]
  onChange: (sort: ResourceSort<Key>) => void
}) {
  const descending = sort.direction === 'desc'
  const current = options.find((option) => option.value === sort.key)?.label ?? sort.key
  const direction = (value: SortDirection, label: string, icon: IconComponent): MenuEntry => ({
    id: `direction:${value}`,
    label,
    icon,
    selected: sort.direction === value,
    keepOpen: true,
    onSelect: () => onChange({ ...sort, direction: value }),
  })
  const entries: MenuEntry[] = [
    { header: 'Sort by' },
    ...options.map((option) => ({
      id: `key:${option.value}`,
      label: option.label,
      selected: option.value === sort.key,
      keepOpen: true,
      onSelect: () => onChange({ ...sort, key: option.value }),
    })),
    { separator: true },
    direction('asc', 'Ascending', ArrowUp),
    direction('desc', 'Descending', ArrowDown),
  ]
  const DirectionIcon = descending ? ArrowDown : ArrowUp

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Sort resources: ${current}, ${descending ? 'descending' : 'ascending'}`}
          className="min-w-0 shrink-0 font-normal text-text-soft"
        >
          <DirectionIcon data-icon="inline-start" aria-hidden />
          <span className="min-w-0 truncate">{current}</span>
          <ChevronDown data-icon="inline-end" className="opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
