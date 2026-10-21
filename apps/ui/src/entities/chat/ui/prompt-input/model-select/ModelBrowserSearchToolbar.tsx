import { useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { CommandInput } from '@localixai/kit/command'
import { IconButton } from '@localixai/kit/icon-button'
import { WorkbenchToolbar } from '@localixai/kit/workbench-toolbar'

interface ModelBrowserSearchToolbarProps {
  search: string
  onSearchChange: (value: string) => void
  armKeyboardNav: () => void
  disabled: boolean
  /** Trailing controls on the same band — the capability filter menu. */
  trailing?: ReactNode
}

/**
 * The model column's search band: one 36px row under its header, the same measure as the
 * provider rail's search band beside it, so the two columns share their second divider too.
 *
 * It searches MODELS only, and drives cmdk's option list: arrows and Enter go to the list,
 * everything else stays in the field. Providers have their own field in the rail.
 */
export function ModelBrowserSearchToolbar({
  search,
  onSearchChange,
  armKeyboardNav,
  disabled,
  trailing,
}: ModelBrowserSearchToolbarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <WorkbenchToolbar
      as="header"
      aria-label="Model search"
      className="gap-1"
      aria-disabled={disabled}
      inert={disabled}
    >
      <CommandInput
        ref={inputRef}
        containerClassName="flex-1 p-0"
        inputGroupClassName="h-(--chrome-control-md)! rounded-md"
        placeholder="Search models…"
        value={search}
        disabled={disabled}
        onValueChange={onSearchChange}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Enter') {
            event.stopPropagation()
          }
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') armKeyboardNav()
        }}
      />
      {search && (
        <IconButton
          size="md"
          aria-label="Clear search"
          disabled={disabled}
          onKeyDown={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            onSearchChange('')
            inputRef.current?.focus()
          }}
        >
          <X />
        </IconButton>
      )}
      {trailing}
    </WorkbenchToolbar>
  )
}
