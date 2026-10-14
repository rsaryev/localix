import type { LucideIcon } from 'lucide-react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  ArrowDown,
  ArrowUp,
  Blend,
  BringToFront,
  LayoutGrid,
  SendToBack,
} from 'lucide-react'
import { Button } from '@localixai/kit/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { formatChordText } from '@localixai/kit/keybindings'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { SpaceOp } from '../../shared/ops/contract'
import { alignOps, distributeOps, opacityOps, stackOps, tidyOps, type Selected } from './commands'

/**
 * The selection bar's three menus — stacking, arranging, opacity — each item one command from
 * `commands.ts` with the key that does the same (`boardKeys.ts`), so the menu teaches the key.
 * An item that does not apply to this selection is left out, not greyed.
 */
interface Item {
  label: string
  Icon: LucideIcon
  chord?: string
  ops: SpaceOp[] | null
}

function Menu({
  label,
  Icon,
  sections,
  commit,
}: {
  label: string
  Icon: LucideIcon
  sections: readonly (readonly Item[])[]
  commit: (ops: readonly SpaceOp[]) => void
}) {
  const shown = sections.map((items) => items.filter((item) => item.ops)).filter((s) => s.length)
  if (shown.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={label} title={label}>
          <Icon className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-52">
        {shown.map((items, index) => (
          <div key={items[0]?.label}>
            {index > 0 && <DropdownMenuSeparator />}
            {items.map((item) => (
              <DropdownMenuItem key={item.label} onSelect={() => item.ops && commit(item.ops)}>
                <item.Icon className="size-3.5" />
                <span className="flex-1">{item.label}</span>
                {item.chord && (
                  <DropdownMenuShortcut>{formatChordText(item.chord)}</DropdownMenuShortcut>
                )}
              </DropdownMenuItem>
            ))}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function StackMenu({ selection, commit }: MenuProps) {
  return (
    <Menu
      label="Stacking order"
      Icon={BringToFront}
      commit={commit}
      sections={[
        [
          {
            label: 'Bring to front',
            Icon: BringToFront,
            chord: 'mod+alt+]',
            ops: stackOps(selection, 'front'),
          },
          {
            label: 'Bring forward',
            Icon: ArrowUp,
            chord: 'mod+]',
            ops: stackOps(selection, 'forward'),
          },
          {
            label: 'Send backward',
            Icon: ArrowDown,
            chord: 'mod+[',
            ops: stackOps(selection, 'backward'),
          },
          {
            label: 'Send to back',
            Icon: SendToBack,
            chord: 'mod+alt+[',
            ops: stackOps(selection, 'back'),
          },
        ],
      ]}
    />
  )
}

export function ArrangeMenu({ selection, commit }: MenuProps) {
  return (
    <Menu
      label="Align and arrange"
      Icon={AlignStartVertical}
      commit={commit}
      sections={[
        [
          {
            label: 'Align left',
            Icon: AlignStartVertical,
            chord: 'alt+a',
            ops: alignOps(selection, 'left'),
          },
          {
            label: 'Align centre',
            Icon: AlignCenterVertical,
            chord: 'alt+h',
            ops: alignOps(selection, 'center'),
          },
          {
            label: 'Align right',
            Icon: AlignEndVertical,
            chord: 'alt+d',
            ops: alignOps(selection, 'right'),
          },
        ],
        [
          {
            label: 'Align top',
            Icon: AlignStartHorizontal,
            chord: 'alt+w',
            ops: alignOps(selection, 'top'),
          },
          {
            label: 'Align middle',
            Icon: AlignCenterHorizontal,
            chord: 'alt+v',
            ops: alignOps(selection, 'middle'),
          },
          {
            label: 'Align bottom',
            Icon: AlignEndHorizontal,
            chord: 'alt+s',
            ops: alignOps(selection, 'bottom'),
          },
        ],
        [
          {
            label: 'Distribute horizontally',
            Icon: AlignHorizontalDistributeCenter,
            chord: 'alt+shift+h',
            ops: distributeOps(selection, 'horizontal'),
          },
          {
            label: 'Distribute vertically',
            Icon: AlignVerticalDistributeCenter,
            chord: 'alt+shift+v',
            ops: distributeOps(selection, 'vertical'),
          },
          { label: 'Tidy up into a grid', Icon: LayoutGrid, ops: tidyOps(selection) },
        ],
      ]}
    />
  )
}

/** The opacity steps: enough to push a picture behind the work, few enough to choose. */
const OPACITY = [1, 0.75, 0.5, 0.25, 0.1]

export function OpacityMenu({ selection, commit }: MenuProps) {
  const values = new Set(selection.ids.map((id) => selection.space.elements[id]?.opacity ?? 1))
  const current = values.size === 1 ? [...values][0] : undefined
  if (!opacityOps(selection, 1)?.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label="Opacity" title="Opacity">
          <Blend className="size-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-36">
        {/* One step among five: `selected` rows. A mixed selection marks none. */}
        <MenuEntries
          family="dropdown"
          entries={[
            { header: 'Opacity' },
            ...OPACITY.map((value) => ({
              id: String(value),
              label: `${Math.round(value * 100)}%`,
              selected: current === value,
              onSelect: () => {
                const ops = opacityOps(selection, value)
                if (ops) commit(ops)
              },
            })),
          ]}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

interface MenuProps {
  selection: Selected
  commit: (ops: readonly SpaceOp[]) => void
}
