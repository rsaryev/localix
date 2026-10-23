import { useRef } from 'react'
import { MoreHorizontal } from 'lucide-react'
import type { PluginTableGridProps } from '@localixai/mini-app-sdk/ui'
import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'

export function ColumnMenu({
  id,
  title,
  index,
  count,
  actions,
  rename,
}: {
  id: string
  title: string
  index: number
  count: number
  actions: NonNullable<PluginTableGridProps['columnActions']>
  rename: () => void
}) {
  const renaming = useRef(false)
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) renaming.current = false
      }}
    >
      <DropdownMenuTrigger asChild>
        <IconButton
          size="xs"
          aria-label={`Column options: ${title}`}
          tooltip="Column options"
          className="ml-auto shrink-0 opacity-0 group-hover/hcell:opacity-100 group-focus-within/hcell:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="size-3" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          if (renaming.current) event.preventDefault()
        }}
      >
        {actions.rename && (
          <DropdownMenuItem
            onSelect={() => {
              renaming.current = true
              rename()
            }}
          >
            Rename column
          </DropdownMenuItem>
        )}
        {actions.insert && (
          <>
            <DropdownMenuItem onSelect={() => actions.insert!(id, 'before')}>
              Insert column before
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => actions.insert!(id, 'after')}>
              Insert column after
            </DropdownMenuItem>
          </>
        )}
        {actions.move && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled={index === 0} onSelect={() => actions.move!(id, 'left')}>
              Move left
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={index === count - 1}
              onSelect={() => actions.move!(id, 'right')}
            >
              Move right
            </DropdownMenuItem>
          </>
        )}
        {actions.remove && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={count === 1}
              tone="danger"
              onSelect={() => actions.remove!(id)}
            >
              Delete column
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
