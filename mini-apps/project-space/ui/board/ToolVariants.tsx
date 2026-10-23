import { IconButton } from '@localixai/kit/icon-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { ElementControl, ElementView } from '../elements/contract'
import type { Tool } from './useTools'
import { spaceTypes } from '../../shared/types'

/**
 * A rail tool's variants (a shape's kind) as the app's pick: `selected` rows, each keeping its
 * icon, the armed one marked with the menu's trailing check. The rows used to place a `<Check>`
 * by hand, on their own geometry beside the kit's — the drift every hand-built picker had.
 */
export function ToolVariants({
  view,
  control,
  active,
  value,
  onTool,
}: {
  view: ElementView
  control: Extract<ElementControl, { kind: 'choice' }>
  active: boolean
  value: unknown
  onTool: (tool: Tool, props?: Record<string, unknown>) => void
}) {
  const defaults = spaceTypes.get(view.type)?.props.safeParse(view.insert?.props ?? {})
  const selectedValue = value ?? (defaults?.success ? defaults.data[control.prop] : undefined)
  const current = control.options.find((option) => option.value === selectedValue)
  const Icon = active && current?.Icon ? current.Icon : view.Icon
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <IconButton
          size="lg"
          aria-label={`${control.label} tools`}
          tooltip={`Choose ${control.label.toLowerCase()}`}
          tooltipSide="right"
          aria-pressed={active}
        >
          <Icon className="size-4" />
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="right" align="start" sideOffset={10} className="min-w-48">
        <MenuEntries
          family="dropdown"
          entries={[
            { header: control.label },
            // Only an ARMED tool has a chosen variant: an idle rail marks none.
            ...control.options.map((option) => ({
              id: option.value,
              label: option.label,
              icon: option.Icon,
              selected: active && current?.value === option.value,
              onSelect: () => onTool(view.type, { [control.prop]: option.value }),
            })),
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
