import { useEffect, useState, type RefObject } from 'react'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@localixai/kit/dropdown-menu'
import { formatChordText } from '@localixai/kit/keybindings'
import { MenuEntries } from '@localixai/kit/menu-entries'
import type { SpaceDocument } from '../../shared/format/document'
import { useStableCallback } from '@localixai/mini-app-sdk/ui/runtime-hooks'
import { menuSections, type MenuContext, type MenuTarget } from './menuItems'

/**
 * The board's right-click menu.
 *
 * The right button already PANS this board (the kit canvas's `PAN_BUTTONS`), so the menu cannot
 * simply open on `contextmenu`: on macOS that event fires as the button goes DOWN, before anyone
 * knows whether a drag follows, and every right-drag pan would have opened a menu. So a right
 * press opens it only when it is released where it went down; a ⌃-click, the menu
 * key and Shift+F10 — which never pan — open it at once. The browser's own menu never shows on
 * the board.
 *
 * What was clicked is read from the page, not from the library's callbacks: `data-id` on the node
 * or the edge under the pointer, else the ground. A locked element lets the pointer through, so a
 * right-click on it is on the ground beneath — the layers panel is where it is reached.
 */
const STILL_PX = 5

interface Open {
  x: number
  y: number
  target: MenuTarget
}

export interface MenuBoard {
  space: SpaceDocument
  selected: ReadonlySet<string>
  select: (ids: Iterable<string>) => void
  toBoard: (clientX: number, clientY: number) => { x: number; y: number }
}

/**
 * What a right-click at a screen point is on. An element outside the selection becomes the
 * selection, as in every design tool, so the menu acts on what the person sees selected.
 */
function targetAt(
  root: HTMLElement | null,
  board: MenuBoard,
  x: number,
  y: number,
): MenuTarget | null {
  const hit = document.elementFromPoint(x, y)
  if (!hit || !root?.contains(hit) || hit.closest('.react-flow__node-toolbar')) return null
  const { space, selected } = board
  const node = hit.closest<HTMLElement>('.react-flow__node')?.dataset.id
  if (node && space.elements[node]) {
    if (selected.has(node))
      return { kind: 'elements', ids: [...selected].filter((id) => space.elements[id]) }
    board.select([node])
    return { kind: 'elements', ids: [node] }
  }
  const edge = hit.closest<HTMLElement>('.react-flow__edge')?.dataset.id
  if (edge && space.edges[edge]) {
    board.select([edge])
    return { kind: 'edge', id: edge }
  }
  return hit.closest('.react-flow__pane') ? { kind: 'ground', at: board.toBoard(x, y) } : null
}

export function useBoardMenu(root: RefObject<HTMLElement | null>, board: MenuBoard) {
  const [open, setOpen] = useState<Open | null>(null)
  // The effect below lives as long as the board, and resolves a press against the board as it is.
  const resolve = useStableCallback((x: number, y: number) => targetAt(root.current, board, x, y))

  useEffect(() => {
    const element = root.current
    if (!element) return
    let press: { x: number; y: number; moved: boolean; waiting: boolean } | null = null
    let released: { moved: boolean; at: number } | null = null
    const show = (x: number, y: number) => {
      const target = resolve(x, y)
      if (target) setOpen({ x, y, target })
    }
    const down = (event: PointerEvent) => {
      if (event.button === 2)
        press = { x: event.clientX, y: event.clientY, moved: false, waiting: false }
    }
    const move = (event: PointerEvent) => {
      if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > STILL_PX)
        press.moved = true
    }
    const up = (event: PointerEvent) => {
      if (event.button !== 2 || !press) return
      const { moved, waiting, x, y } = press
      press = null
      released = { moved, at: Date.now() }
      if (waiting && !moved) show(x, y)
    }
    const menu = (event: MouseEvent) => {
      if (!(event.target as Element | null)?.closest?.('.react-flow')) return
      event.preventDefault()
      // macOS: the button is still down — decide on release.
      if (press) return void (press.waiting = true)
      // Windows and Linux: the release came first and said whether it was a drag.
      if (released && Date.now() - released.at < 400) {
        const moved = released.moved
        released = null
        if (!moved) show(event.clientX, event.clientY)
        return
      }
      // ⌃-click, the menu key, Shift+F10: no drag to tell apart. A key's event has no point.
      const box = element.getBoundingClientRect()
      const keyed = event.clientX === 0 && event.clientY === 0
      show(
        keyed ? box.left + box.width / 2 : event.clientX,
        keyed ? box.top + box.height / 2 : event.clientY,
      )
    }
    element.addEventListener('pointerdown', down, true)
    window.addEventListener('pointermove', move, true)
    window.addEventListener('pointerup', up, true)
    element.addEventListener('contextmenu', menu)
    return () => {
      element.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointermove', move, true)
      window.removeEventListener('pointerup', up, true)
      element.removeEventListener('contextmenu', menu)
    }
  }, [root, resolve])

  return { open, close: () => setOpen(null) }
}

export function BoardMenu({
  root,
  open,
  close,
  context,
}: {
  root: RefObject<HTMLElement | null>
  open: Open | null
  close: () => void
  context: MenuContext
}) {
  const sections = open ? menuSections(open.target, context) : []
  // The app's one menu walker (`@localixai/kit/menu-entries`): its separators, its danger tint.
  const entries: MenuEntry[] = sections.flatMap((items, index) => [
    ...(index > 0 ? [{ separator: true as const }] : []),
    ...items.map((item) => ({
      id: item.label,
      label: item.label,
      icon: item.Icon,
      ...(item.chord ? { hint: formatChordText(item.chord) } : {}),
      ...(item.danger ? { danger: true } : {}),
      onSelect: item.run,
    })),
  ])
  return (
    <DropdownMenu
      open={open !== null && entries.length > 0}
      onOpenChange={(next) => !next && close()}
    >
      <DropdownMenuTrigger asChild>
        {/* The menu's anchor: a point where the pointer was, inside the board. */}
        <span
          aria-hidden
          className="pointer-events-none absolute size-0"
          ref={(anchor) => {
            // Placed against the board's own box, read once the board is on screen.
            const box = root.current?.getBoundingClientRect()
            if (!anchor || !open || !box) return
            anchor.style.left = `${open.x - box.left}px`
            anchor.style.top = `${open.y - box.top}px`
          }}
          style={{ left: 0, top: 0 }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <MenuEntries entries={entries} family="dropdown" />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
