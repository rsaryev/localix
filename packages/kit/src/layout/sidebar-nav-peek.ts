import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import type { FocusEvent, KeyboardEvent, MouseEvent, PointerEvent } from 'react'

/** Timing of the compact rail's hover-to-open panel; every part can be replaced by a test. */
export interface SidebarNavPeek {
  /** Pointer dwell before the panel opens, so a pass across the rail does not open it. */
  openDelayMs?: number
  /** Grace after the pointer leaves, so a diagonal move toward the panel does not close it. */
  closeDelayMs?: number
  /** Starts a timer and returns its cancel. Defaults to `setTimeout`. */
  schedule?: (run: () => void, ms: number) => () => void
}

const defaultSchedule = (run: () => void, ms: number) => {
  const id = setTimeout(run, ms)
  return () => clearTimeout(id)
}

/**
 * When the compact rail's panel is open. It opens on a hovering mouse after a short dwell and on
 * keyboard focus; it closes on leaving (after a grace), Esc, choosing a row, focus leaving, and a
 * touch outside, unless it is pinned: the toggle button pins it open until pressed again. A touch on the rail toggles it. It never opens while a button is held. The panel
 * floats over the content, so none of this moves anything.
 */
export function useSidebarNavPeek(
  enabled: boolean,
  root: RefObject<HTMLElement | null>,
  { openDelayMs = 120, closeDelayMs = 200, schedule = defaultSchedule }: SidebarNavPeek = {},
) {
  const [open, setOpen] = useState(false)
  const [pinned, setPinned] = useState(false)
  const cancel = useRef<(() => void) | null>(null)
  const pointerFocus = useRef(false)
  const touched = useRef({ wasOpen: false, active: false })
  const shown = enabled && (open || pinned)

  const clear = useCallback(() => {
    cancel.current?.()
    cancel.current = null
  }, [])
  const later = (value: boolean, ms: number) => {
    clear()
    cancel.current = schedule(() => {
      cancel.current = null
      setOpen(value)
    }, ms)
  }
  const set = (value: boolean) => {
    clear()
    setOpen(value)
  }
  useEffect(() => clear, [clear])

  useEffect(() => {
    if (!shown) return
    const outside = (event: globalThis.PointerEvent) => {
      if (root.current?.contains(event.target as Node)) return
      clear()
      setOpen(false)
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [shown, root, clear])

  const handlers = {
    onPointerEnter: (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.buttons !== 0) return
      later(true, openDelayMs)
    },
    onPointerLeave: (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      later(false, closeDelayMs)
    },
    onPointerDownCapture: (event: PointerEvent) => {
      pointerFocus.current = true
      const touch = event.pointerType === 'touch'
      touched.current = { wasOpen: shown, active: touch }
      if (touch) set(!shown)
    },
    // A first touch on a row only opens the panel; it does not also choose the row.
    onClickCapture: (event: MouseEvent) => {
      const { wasOpen, active } = touched.current
      if (active && !wasOpen) event.stopPropagation()
    },
    onKeyDownCapture: (event: KeyboardEvent) => {
      pointerFocus.current = false
      if (event.key === 'Escape' && shown) {
        set(false)
        event.stopPropagation()
      }
    },
    onFocus: () => {
      if (!pointerFocus.current) set(true)
    },
    onBlur: (event: FocusEvent) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) set(false)
    },
  }
  return {
    open: shown,
    close: () => set(false),
    // A touch already toggled on pointer down.
    toggle: () => {
      if (touched.current.active) return
      clear()
      setPinned(!pinned)
      setOpen(!pinned)
    },
    handlers,
  }
}
