import { ChevronDown, X } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'

export interface FilterOption {
  value: string
  label: string
  count?: number
}

/**
 * One filter as a chip: its name while nothing is chosen ("Category"), the choice once one is
 * ("Data"), a menu of the options with how many each holds, and a clear button beside a choice.
 */
export function FilterMenu({
  label,
  options,
  value,
  onChange,
}: {
  label: string
  options: readonly FilterOption[]
  value: string | null
  onChange: (value: string | null) => void
}) {
  const chosen = options.find((option) => option.value === value)
  const entries: MenuEntry[] = [
    {
      id: 'any',
      label: `Any ${label.toLowerCase()}`,
      selected: value === null,
      onSelect: () => onChange(null),
    },
    { separator: true },
    ...options.map((option) => ({
      id: option.value,
      label: option.label,
      ...(option.count !== undefined ? { hint: option.count.toLocaleString('en-US') } : {}),
      selected: option.value === value,
      onSelect: () => onChange(option.value),
    })),
  ]
  return (
    <span className="inline-flex items-center">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant={chosen ? 'secondary' : 'field'}
            aria-label={chosen ? `${label}: ${chosen.label}` : label}
            className={chosen ? 'rounded-r-none pr-1.5' : undefined}
          >
            {chosen?.label ?? label}
            <ChevronDown data-icon="inline-end" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-60 overflow-y-auto">
          <MenuEntries entries={entries} family="dropdown" />
        </DropdownMenuContent>
      </DropdownMenu>
      {chosen && (
        <IconButton
          size="sm"
          aria-label={`Clear ${label.toLowerCase()}`}
          className="rounded-l-none bg-field-fill"
          onClick={() => onChange(null)}
        >
          <X />
        </IconButton>
      )}
    </span>
  )
}
