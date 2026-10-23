import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { History } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { IconButton } from '@localixai/kit/icon-button'
import { Popover, PopoverContent, PopoverTrigger } from '@localixai/kit/popover'
import { railBtn, railBtnActive } from '@localixai/kit/rail-button'
import { useRailRecentsMode } from '@/shared/lib/railRecentsPref'
import { splitRecents } from '../model/recentsDisclosure'
import type { RailEntry } from './shellTypes'

/** Icons per column in the flyout before it grows a second one, Dock-folder style. */
const FLYOUT_COLUMN_ROWS = 5

/** Hover intent: long enough that crossing the trigger does not open the dock… */
const OPEN_DELAY_MS = 120
/** …and a leave grace that covers the gap between the trigger and the flyout. */
const CLOSE_DELAY_MS = 220

/** What the dock hands each slot it asks the rail to render. */
export interface RailRecentsSlotApi {
  /** Wire to the slot's context menu: an open menu keeps the flyout on screen. */
  onMenuOpenChange: (open: boolean) => void
}

interface RailRecentsDockProps {
  /** Recent slots, most recently opened first. */
  entries: RailEntry[]
  /** Renders one slot — owned by the rail so the dock needs no drag/menu props. */
  renderEntry: (entry: RailEntry, api: RailRecentsSlotApi) => ReactNode
  /** A rail drag is in flight: the flyout stays shut so it can't eat the drop. */
  dragging: boolean
}

/**
 * The rail's Dock-style recents, collapsed behind one disclosure button.
 *
 * Transient icons resting in the rail read as noise, so by default the rail spends
 * exactly ONE slot on recents no matter how many there are (see splitRecents) and
 * the icons live in a flyout that opens on hover or on click. Opening a view must
 * not change that count, so the trigger itself carries "you are here": it wears the
 * open view's icon and the active accent instead of letting it out onto the rail.
 *
 * The flyout is a portalled popover rather than an in-rail expansion on purpose:
 * growing the rail under the pointer would shove the plugin launcher and everything below
 * it out from under the cursor.
 *
 * `railRecentsPref` chooses between this, always-expanded, and off.
 */
export function RailRecentsDock({ entries, renderEntry, dragging }: RailRecentsDockProps) {
  const mode = useRailRecentsMode()
  const { visible, collapsed } = splitRecents(entries, mode)
  const [hovered, setHovered] = useState(false)
  const [sticky, setSticky] = useState(false)
  // A slot's context menu portals OUT of the flyout, so without this the menu's own
  // opening reads as an interaction outside it: the flyout dismissed, the button
  // unmounted, and the menu vanished before it could be read, let alone clicked.
  const [menuOpen, setMenuOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const timer = useRef<number | null>(null)
  // True when THIS open came from the keyboard/pointer activating the trigger, so
  // focus should move into the flyout and back out again. A hover-open must never
  // take focus away from whatever the user was doing.
  const focusOnOpen = useRef(false)

  const cancelTimer = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
  }, [])

  // Defer BOTH edges: opening on intent, closing on a grace period that spans the
  // trigger→flyout gap. Every path funnels through here, so no timer outlives the
  // component or races a second one.
  const scheduleHover = useCallback(
    (next: boolean) => {
      cancelTimer()
      timer.current = window.setTimeout(
        () => {
          timer.current = null
          setHovered(next)
        },
        next ? OPEN_DELAY_MS : CLOSE_DELAY_MS,
      )
    },
    [cancelTimer],
  )

  useEffect(() => cancelTimer, [cancelTimer])

  const close = useCallback(() => {
    cancelTimer()
    setHovered(false)
    setSticky(false)
  }, [cancelTimer])

  // A drag started while the dock was open: shut it in the same beat.
  useEffect(() => {
    if (dragging) close()
  }, [dragging, close])

  const open = !dragging && (sticky || hovered || menuOpen)
  // The dock stands in for whichever recent view is on screen, so the trigger
  // borrows its icon and active accent. Nothing open → the neutral history glyph.
  const activeEntry = collapsed.find((entry) => entry.active)
  // Two short columns beat one tall one once the history runs deep: the flyout
  // stays inside the viewport without becoming a second scroll surface.
  const flyoutRows = Math.min(collapsed.length, FLYOUT_COLUMN_ROWS)

  // A menu opened from a slot also PINS the flyout, so dismissing the menu leaves
  // the icons up rather than snatching them away mid-gesture.
  const slotApi: RailRecentsSlotApi = {
    onMenuOpenChange: (next: boolean) => {
      setMenuOpen(next)
      if (next) {
        cancelTimer()
        setHovered(false)
        setSticky(true)
      }
    },
  }

  // Arrow keys walk the flyout's icons; Radix owns Tab, Escape and focus return.
  const onContentKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const buttons = Array.from(
      contentRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    )
    if (buttons.length === 0) return
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const step = event.key === 'ArrowDown' ? 1 : -1
    event.preventDefault()
    buttons[(at + step + buttons.length) % buttons.length]?.focus()
  }

  if (visible.length === 0 && collapsed.length === 0) return null

  return (
    <>
      {/* A SHORT inset hairline separates recents from the core destinations above —
        a full RailDivider would read as a group boundary and make a transient slot
        look permanent. */}
      <div aria-hidden="true" className="my-0.5 h-px w-5 shrink-0 rounded-full bg-sidebar-border" />
      {visible.map((entry) => renderEntry(entry, slotApi))}
      {collapsed.length > 0 ? (
        <Popover
          open={open}
          onOpenChange={(next) => {
            // Radix only reports dismissals here (Escape, outside press) — the
            // trigger's own toggle is suppressed below so hover and click can't
            // fight over one open state.
            if (!next) close()
          }}
        >
          <PopoverTrigger asChild>
            <IconButton
              data-rail-recents-trigger=""
              aria-label={
                activeEntry
                  ? `Recent views (${collapsed.length}), showing ${activeEntry.label}`
                  : `Recent views (${collapsed.length})`
              }
              aria-current={activeEntry ? 'true' : undefined}
              size="touch"
              className={cn(
                railBtn,
                'text-text-faint hover:text-text-soft',
                activeEntry && railBtnActive,
              )}
              onPointerEnter={() => scheduleHover(true)}
              onPointerLeave={() => scheduleHover(false)}
              onClick={(event) => {
                // Suppress Radix's own toggle (it checks defaultPrevented): a click
                // PINS the dock open instead of undoing what hover just opened, and
                // it is the only way in on touch, where there is no hover at all.
                event.preventDefault()
                if (sticky) {
                  close()
                  return
                }
                cancelTimer()
                focusOnOpen.current = true
                setHovered(false)
                setSticky(true)
              }}
            >
              {activeEntry ? activeEntry.icon : <History className="size-4.5" />}
              {collapsed.length > 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute right-1.5 bottom-1 text-2xs leading-none font-medium tabular-nums text-text-faint"
                >
                  {collapsed.length}
                </span>
              ) : null}
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            ref={contentRef}
            side="right"
            align="center"
            sideOffset={4}
            aria-label="Recent views"
            // `overflow-visible` so each icon's own tooltip is not clipped by the
            // flyout's edge; the stack is short by construction (MAX_RAIL_RECENTS).
            className="w-auto gap-0 overflow-visible p-1 motion-reduce:animate-none"
            // A hover-opened flyout must not steal focus; a click- or key-opened
            // one must, so its icons are reachable without the pointer.
            onOpenAutoFocus={(event) => {
              if (!focusOnOpen.current) event.preventDefault()
            }}
            onCloseAutoFocus={(event) => {
              // Read-then-clear: the flag has to survive `close()` clearing state so
              // Escape still returns focus to the trigger it came from.
              if (!focusOnOpen.current) event.preventDefault()
              focusOnOpen.current = false
            }}
            onPointerEnter={cancelTimer}
            onPointerLeave={() => {
              // Travelling to a slot's context menu leaves the flyout; the menu is
              // holding it open, so there is nothing to schedule.
              if (!menuOpen) scheduleHover(false)
            }}
            // Radix asks before dismissing: an interaction inside a menu this flyout
            // spawned is not "outside" in any sense the user would recognise.
            onInteractOutside={(event) => {
              const target = event.target
              if (
                menuOpen ||
                (target instanceof Element && target.closest('[data-radix-menu-content]'))
              ) {
                event.preventDefault()
              }
            }}
            onKeyDown={onContentKeyDown}
            // Opening a view from here is a navigation: the dock gets out of the way.
            onClickCapture={close}
          >
            <div
              className="grid grid-flow-col items-center gap-1"
              style={{ gridTemplateRows: `repeat(${flyoutRows}, min-content)` }}
            >
              {collapsed.map((entry) => renderEntry(entry, slotApi))}
            </div>
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  )
}
