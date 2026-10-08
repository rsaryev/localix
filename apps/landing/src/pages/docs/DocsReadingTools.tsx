import { Type } from 'lucide-react'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'

export type ReadingSize = 'standard' | 'large' | 'larger'

export function DocsReadingTools({
  size,
  onSize,
}: {
  size: ReadingSize
  onSize: (size: ReadingSize) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <IconButton aria-label="Reading options" size="touch">
            <Type className="size-4" />
          </IconButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <MenuEntries
            family="dropdown"
            entries={(
              [
                ['standard', 'Standard text'],
                ['large', 'Large text'],
                ['larger', 'Larger text'],
              ] as const
            ).map(([id, label]) => ({
              id,
              label,
              selected: size === id,
              onSelect: () => onSize(id),
            }))}
          />
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
