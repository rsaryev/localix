import { Baseline, Check, ChevronDown } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
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
import type { IconComponent, MenuEntry } from '@localixai/mini-app-sdk/ui'
import { COLORS, type SpaceColor } from '../../shared/format/schema'
import type { ElementControl } from '../elements/contract'

/**
 * The pickers every bar is made of: colour swatches, a list of choices, and the one Text menu
 * that gathers a type's text settings. A value that differs across the selection is shown as
 * mixed and picking writes it to all of them.
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
  const Icon = current?.Icon ?? control.Icon
  const named = `${control.label}: ${current?.label ?? 'Mixed'}`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {Icon ? (
          // Among the bar's icons a choice is an icon too; its name and value are the tooltip.
          <IconButton size="sm" aria-label={named} tooltip={named}>
            <Icon className="size-3.5" />
          </IconButton>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            aria-label={control.label}
            title={control.label}
            className="gap-1 px-1.5"
          >
            <span className="text-2xs">{named}</span>
            <ChevronDown aria-hidden className="size-3 text-text-faint" />
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36">
        {/* A choice maps 1:1 onto `selected` rows; a mixed selection simply marks none. */}
        <MenuEntries family="dropdown" entries={choiceRows(control, value, onPick)} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const choiceRows = (
  control: Extract<ElementControl, { kind: 'choice' }>,
  value: string | undefined,
  onPick: (value: string) => void,
  keepOpen = false,
): MenuEntry[] =>
  control.options.map((option) => ({
    id: option.value,
    label: option.label,
    icon: option.Icon,
    selected: option.value === value,
    keepOpen,
    onSelect: () => onPick(option.value),
  }))

/** A palette colour drawn where a menu row's icon goes. */
const SWATCHES = Object.fromEntries(
  COLORS.map((color) => [
    color,
    ({ className }: { className?: string }) => (
      <span className={cn('space-swatch rounded-full', `space-tone-${color}`, className)} />
    ),
  ]),
) as Record<SpaceColor, IconComponent>

const COLOR_NAME: Record<SpaceColor, string> = {
  gray: 'Grey',
  red: 'Red',
  orange: 'Orange',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  purple: 'Purple',
  pink: 'Pink',
}

/**
 * A family of settings behind ONE icon — how text is set (face, size, alignment, colour), how a
 * line runs (route, ends, style, weight) — each a level whose hint is the current pick. Five
 * pickers in a row read as a word processor's ribbon on a sticky note; one menu keeps the bar to
 * what a glance needs, and a pick keeps the menu open so the next one is a click away.
 */
export function StyleMenu({
  label,
  Icon,
  controls,
  valueOf,
  onPick,
}: {
  label: string
  Icon: IconComponent
  controls: readonly ElementControl[]
  valueOf: (prop: string) => string | undefined
  /** `null` returns the prop to the type's default (an automatic text colour). */
  onPick: (prop: string, value: string | null) => void
}) {
  if (controls.length === 0) return null
  const entries: MenuEntry[] = controls.map((control) => {
    const value = valueOf(control.prop)
    if (control.kind === 'color')
      return {
        id: control.prop,
        label: control.label,
        icon: value ? SWATCHES[value as SpaceColor] : Baseline,
        hint: value ? COLOR_NAME[value as SpaceColor] : 'Automatic',
        items: [
          {
            id: 'auto',
            label: 'Automatic',
            icon: Baseline,
            selected: !value,
            keepOpen: true,
            onSelect: () => onPick(control.prop, null),
          },
          ...COLORS.map((color) => ({
            id: color,
            label: COLOR_NAME[color],
            icon: SWATCHES[color],
            selected: value === color,
            keepOpen: true,
            onSelect: () => onPick(control.prop, color),
          })),
        ],
      }
    const current = control.options.find((option) => option.value === value)
    return {
      id: control.prop,
      label: control.label,
      icon: current?.Icon ?? control.Icon,
      hint: current?.label ?? 'Mixed',
      items: choiceRows(control, value, (picked) => onPick(control.prop, picked), true),
    }
  })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton size="sm" aria-label={label} tooltip={label}>
          <Icon className="size-3.5" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-52">
        <MenuEntries family="dropdown" entries={entries} />
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
