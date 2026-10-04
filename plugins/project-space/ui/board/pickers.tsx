import { Check, ChevronDown } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { FloatingActionDivider, FloatingActionGroup } from '@localixai/kit/workbench-toolbar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { COLORS } from '../../shared/format/schema'
import type { ElementControl } from '../elements/contract'

/**
 * The two pickers every bar is made of: colour swatches and a list of choices. A value that
 * differs across the selection is shown as mixed and picking writes it to all of them.
 */
export function ColorPicker({
  label,
  value,
  onPick,
}: {
  label: string
  value: string | undefined
  onPick: (value: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={label} tooltip={label}>
          <span
            className={cn('space-swatch size-4 rounded-full', value && `space-tone-${value}`)}
          />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="grid grid-cols-4 gap-1 p-1.5">
        {COLORS.map((color) => (
          <DropdownMenuItem
            key={color}
            aria-label={color}
            className="flex size-8 items-center justify-center p-0"
            onSelect={() => onPick(color)}
          >
            <span
              className={cn(
                'space-swatch flex size-5 items-center justify-center rounded-full',
                `space-tone-${color}`,
              )}
            >
              {value === color && <Check aria-hidden className="size-3" />}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function ChoicePicker({
  control,
  value,
  onPick,
}: {
  control: Extract<ElementControl, { kind: 'choice' }>
  value: string | undefined
  onPick: (value: string) => void
}) {
  const current = control.options.find((option) => option.value === value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          aria-label={control.label}
          title={control.label}
          className="gap-1 px-1.5"
        >
          {current?.Icon ? (
            <current.Icon className="size-3.5" />
          ) : (
            <span className="text-2xs">
              {control.label}: {current?.label ?? 'Mixed'}
            </span>
          )}
          <ChevronDown aria-hidden className="size-3 text-text-faint" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36">
        {/* A choice maps 1:1 onto `selected` rows; a mixed selection simply marks none. */}
        <MenuEntries
          family="dropdown"
          entries={control.options.map((option) => ({
            id: option.value,
            label: option.label,
            icon: option.Icon,
            selected: option.value === value,
            onSelect: () => onPick(option.value),
          }))}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The bar every picker sits in: one surface, one height, whatever it holds. */
export function BarSurface({
  children,
  className,
  label = 'Selection actions',
}: {
  children: React.ReactNode
  className?: string
  label?: string
}) {
  return (
    <FloatingActionGroup
      aria-label={label}
      wrap
      className={cn(
        'nodrag nowheel static right-auto top-auto min-h-[var(--panel-header-height)] max-w-[calc(100cqw-2rem)] justify-start gap-0.5 px-1',
        className,
      )}
    >
      {children}
    </FloatingActionGroup>
  )
}

export const BarDivider = FloatingActionDivider
