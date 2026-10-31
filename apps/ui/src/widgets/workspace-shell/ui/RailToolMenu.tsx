import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Pin, Settings2 } from 'lucide-react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import type { MiniAppCategory } from '@localixai/mini-app-sdk/manifest'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { railBtn, railBtnActive } from '@localixai/kit/rail-button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { groupRailTools } from '../model/railToolGroups'
import type { RailEntry } from './shellTypes'
import { useRailToolMenuGroup } from './RailToolMenuGroup'
import { RAIL_HOVER_CLOSE_MS, RAIL_HOVER_OPEN_MS } from '../model/railMenuState'

interface RailToolMenuProps {
  entries: readonly RailEntry[]
  categories?: ReadonlyMap<string, MiniAppCategory | undefined>
  label: string
  icon: ReactNode
  active: boolean
  pending?: boolean
  category?: string
  pinnedIds?: ReadonlySet<string>
  onPinChange?: (id: string, pinned: boolean) => void
  onManage?: () => void
}

export function RailToolMenu({
  entries,
  categories,
  label,
  icon,
  active,
  pending,
  category,
  pinnedIds,
  onPinChange,
  onManage,
}: RailToolMenuProps) {
  const id = useId()
  const { state, current, send } = useRailToolMenuGroup()
  const open = state?.id === id
  const focusOnOpen = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const cancelTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
  }
  useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      send({ type: 'dismiss', id })
    },
    [id, send],
  )
  const hover = (next: boolean) => {
    cancelTimer()
    const activeMenu = current()
    if (next && activeMenu?.id === id) return
    if (!next && activeMenu?.id === id && activeMenu.mode === 'press') return
    timer.current = setTimeout(
      () => {
        timer.current = null
        if (next) focusOnOpen.current = false
        send({ type: next ? 'hover' : 'leave', id })
      },
      next ? RAIL_HOVER_OPEN_MS : RAIL_HOVER_CLOSE_MS,
    )
  }
  const changeOpen = (next: boolean) => {
    cancelTimer()
    if (next) focusOnOpen.current = true
    send(next ? { type: 'press', id, forceOpen: true } : { type: 'dismiss', id })
  }
  const press = (forceOpen = false) => {
    cancelTimer()
    focusOnOpen.current = true
    send({ type: 'press', id, forceOpen })
    if (current()?.id === id) contentRef.current?.focus()
  }
  const menu: MenuEntry[] = groupRailTools(entries, categories).flatMap((group) => [
    { header: group.label },
    ...group.entries.map((entry): MenuEntry => ({
      id: entry.id,
      label: entry.label.split(' — ')[0],
      icon: () => entry.icon,
      selected: entry.active,
      onSelect: () => entry.onClick(),
      ...(onPinChange
        ? {
            trailingAction: {
              label: `${pinnedIds?.has(entry.id) ? 'Unpin' : 'Pin'} ${entry.label.split(' — ')[0]}`,
              icon: Pin,
              checked: pinnedIds?.has(entry.id) ?? false,
              onSelect: () => onPinChange(entry.id, !pinnedIds?.has(entry.id)),
            },
          }
        : {}),
    })),
  ])
  if (menu.length === 0)
    menu.push({
      id: 'empty',
      label: pending ? 'Loading tools…' : 'No tools available',
      disabled: true,
      onSelect: () => {},
    })
  return (
    <DropdownMenu open={open} onOpenChange={changeOpen} modal={false}>
      <DropdownMenuTrigger
        asChild
        onPointerDown={(event) => {
          if (event.button !== 0 || event.ctrlKey) return
          event.preventDefault()
          press()
        }}
        onKeyDown={(event) => {
          if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return
          event.preventDefault()
          press(event.key === 'ArrowDown')
        }}
      >
        <IconButton
          size="touch"
          aria-label={label}
          data-rail-tool-menu-trigger
          data-rail-category={category}
          aria-current={active ? 'true' : undefined}
          className={cn(railBtn, active && railBtnActive)}
          onMouseEnter={() => hover(true)}
          onMouseLeave={() => hover(false)}
        >
          {icon}
        </IconButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        ref={contentRef}
        side="right"
        align="start"
        className="flex max-h-[min(28rem,70dvh,var(--radix-dropdown-menu-content-available-height))] w-64 flex-col overflow-hidden p-0"
        onMouseEnter={cancelTimer}
        onMouseLeave={() => hover(false)}
        onInteractOutside={(event) => {
          // The group owns trigger switching; outside dismissal must not race that same press.
          if (
            event.target instanceof Element &&
            event.target.closest('[data-rail-tool-menu-trigger]')
          ) {
            event.preventDefault()
          }
        }}
        onOpenAutoFocus={(event) => {
          if (!focusOnOpen.current) event.preventDefault()
        }}
        onCloseAutoFocus={(event) => {
          if (!focusOnOpen.current || (current() !== null && current()?.id !== id))
            event.preventDefault()
        }}
      >
        <div
          data-rail-tool-menu-list
          className="min-h-0 overflow-y-auto overscroll-contain p-1 scrollbar-thin"
        >
          <MenuEntries entries={menu} family="dropdown" />
        </div>
        {onManage && (
          <div data-rail-tool-menu-footer className="shrink-0 border-t border-border-soft p-1">
            <MenuEntries
              family="dropdown"
              entries={[
                { id: 'manage', label: 'Manage mini apps…', icon: Settings2, onSelect: onManage },
              ]}
            />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
