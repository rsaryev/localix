import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { startResizeSession } from '@localixai/kit/pane-resize'
import { loadString, saveString } from '@localixai/plugin-sdk/ui/storage'

const SIDEBAR_MIN = 220
const SIDEBAR_MAX = 440
const SIDEBAR_DEFAULT = 300
const SIDEBAR_WIDTH_KEY = 'localix_sidebar_width_v4'
const KEYBOARD_STEP = 16

/** The custom property the sidebar's `width` reads. Set on the panel element, so the
 *  panel and its inner content column both resolve the same live value. */
export const SIDEBAR_WIDTH_VAR = '--sidebar-width'

function loadSidebarWidth(): number {
  const raw = Number(loadString(SIDEBAR_WIDTH_KEY))
  return Number.isFinite(raw) && raw >= SIDEBAR_MIN && raw <= SIDEBAR_MAX ? raw : SIDEBAR_DEFAULT
}

export interface SidebarResize {
  /** The COMMITTED width — the React-rendered value (initial, keyboard, reset, drag
   *  end). During a drag the live width is on the DOM instead; see `panelRef`. */
  sidebarWidth: number
  /** True only WHILE dragging — lets the caller suspend the width transition. */
  resizing: boolean
  onResizeStart: (e: React.MouseEvent) => void
  /** Arrow/Home/End/Enter keyboard contract for the adjustable separator. */
  onResizeKeyDown: (e: React.KeyboardEvent) => void
  min: number
  max: number
  /** Snap back to the default width (e.g. on a double-click of the handle). */
  resetWidth: () => void
  /** The sidebar panel element. Its `--sidebar-width` custom property is the width
   *  the browser paints, so a drag repaints without re-rendering the shell tree. */
  panelRef: React.RefObject<HTMLDivElement | null>
  /** The sash element. `aria-valuenow` / `aria-valuetext` are written straight to it
   *  during a drag, so assistive technology reads the live width even though React
   *  state is only committed on mouse-up. */
  sashRef: React.RefObject<HTMLDivElement | null>
}

/**
 * Draggable sidebar width with localStorage persistence (clamped to
 * [MIN, MAX]). Tracks the cursor 1:1 during a drag and persists once per drag on
 * mouse-up. Extracted from WorkspaceShell.
 *
 * The drag is DOM-driven: every mousemove writes the
 * `--sidebar-width` custom property (what the browser paints) and the sash's ARIA
 * value (what a screen reader announces) directly, and React state is committed once
 * on mouse-up. Keeping the width in state for the duration of the drag re-rendered
 * the whole shell 60–120×/s for a value only CSS needed.
 */
export function useSidebarResize(): SidebarResize {
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth)
  // Width transition is suspended only WHILE dragging the resize handle, so the
  // open/close slide still animates but the drag tracks the cursor 1:1.
  const [resizing, setResizing] = useState(false)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const sashRef = useRef<HTMLDivElement | null>(null)
  // The LIVE width — the single source of truth for what is painted/announced.
  // State follows it at commit points; during a drag only this moves.
  const widthRef = useRef(sidebarWidth)
  // Active-drag teardown (remove listeners + restore body cursor/selection).
  // Held in a ref so an unmount mid-drag can run it — otherwise the listeners
  // leak and the page is left stuck with `cursor: col-resize` / no selection.
  const teardownRef = useRef<(() => void) | null>(null)

  /** Push a width to the DOM: the painted custom property + the announced ARIA value. */
  const paint = useCallback((width: number) => {
    widthRef.current = width
    panelRef.current?.style.setProperty(SIDEBAR_WIDTH_VAR, `${width}px`)
    const sash = sashRef.current
    if (sash) {
      const wholePixels = Math.round(width)
      sash.setAttribute('aria-valuenow', String(wholePixels))
      sash.setAttribute('aria-valuetext', `${wholePixels} pixels`)
    }
  }, [])

  // Re-assert after EVERY render (including the mount, and including a render the
  // shell does for its own reasons mid-drag, which would otherwise repaint the stale
  // committed width and snap the sidebar out from under the cursor).
  useLayoutEffect(() => paint(widthRef.current))

  /** A committed change (keyboard, reset, drag end): move the DOM and React together. */
  const commit = useCallback(
    (width: number, persist: boolean) => {
      paint(width)
      setSidebarWidth(width)
      if (persist) saveString(SIDEBAR_WIDTH_KEY, String(width))
    },
    [paint],
  )

  const onResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || teardownRef.current) return
      e.preventDefault()
      setResizing(true)
      const startX = e.clientX
      const startWidth = widthRef.current
      const end = () => {
        setResizing(false)
        commit(widthRef.current, true)
        teardownRef.current = null
      }
      teardownRef.current = startResizeSession(e, {
        cursor: 'col-resize',
        onMove: (next) => {
          paint(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + next.clientX - startX)))
        },
        onEnd: end,
        onCancel: () => {
          paint(startWidth)
          end()
        },
      })
    },
    [commit, paint],
  )

  const resetWidth = useCallback(() => commit(SIDEBAR_DEFAULT, true), [commit])

  const onResizeKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const step = e.shiftKey ? KEYBOARD_STEP * 4 : KEYBOARD_STEP
      let next: number
      if (e.key === 'ArrowRight') next = widthRef.current + step
      else if (e.key === 'ArrowLeft') next = widthRef.current - step
      else if (e.key === 'Home') next = SIDEBAR_MIN
      else if (e.key === 'End') next = SIDEBAR_MAX
      else if (e.key === 'Enter' || e.key === ' ') next = SIDEBAR_DEFAULT
      else return

      e.preventDefault()
      commit(Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, next)), true)
    },
    [commit],
  )

  // Safety net: if the shell unmounts while a drag is in flight, tear it down.
  useEffect(() => () => teardownRef.current?.(), [])

  // Honor a global "reset layout" (the rail's reset button) — snap back to the
  // default width alongside the inspector layout reset.
  useEffect(() => {
    const onReset = () => resetWidth()
    window.addEventListener('localix:reset-layout', onReset)
    return () => window.removeEventListener('localix:reset-layout', onReset)
  }, [resetWidth])

  return {
    sidebarWidth,
    resizing,
    onResizeStart,
    onResizeKeyDown,
    resetWidth,
    panelRef,
    sashRef,
    min: SIDEBAR_MIN,
    max: SIDEBAR_MAX,
  }
}
