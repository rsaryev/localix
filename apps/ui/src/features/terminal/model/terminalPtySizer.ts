import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
import type { TerminalClientFrame } from '@localixai/api/client'
import {
  shouldFitHost,
  planPtyResize,
  PTY_RESIZE_DEBOUNCE_MS,
  type PtySize,
} from './terminalResize'

/**
 * Fit + PTY sizing glue for a terminal pane (the pure gating/clamping decisions
 * live in terminalResize.ts). Fit runs only while the host has REAL dimensions:
 * the fit addon clamps to a 2×1 floor, so fitting a transitionally-0px host (grid
 * re-layout, sash dragged shut) would reflow the scrollback at 2 columns
 * DESTRUCTIVELY and SIGWINCH a full-screen TUI (claude, vim) into garbage. The PTY
 * side is deduped (a repeat of the same size is never sent), clamped ≥2×2, and
 * trailing-debounced so a sash drag re-fits xterm per frame but the app repaints
 * once, on settle.
 *
 * Owns the small mutable resize state (`lastSentSize`, the debounce timer,
 * `sizeDirty`) so the pane's lifecycle effect doesn't have to. Behavior mirrors
 * the previous inline implementation exactly:
 * - `fit()` re-fits xterm to the host (no-op when hidden/collapsed) and schedules
 *   a debounced PTY resize.
 * - `sync(immediate)` flushes now (immediate) or debounced.
 * - `reset()` clears the dedupe so the next sync always re-asserts the size — used
 *   on a fresh WS attach (the PTY may have been created 80×24 or drifted).
 * - `dispose()` cancels any pending debounce (teardown).
 */
export interface PtySizer {
  fit: () => void
  sync: (immediate?: boolean) => void
  reset: () => void
  dispose: () => void
}

export function createPtySizer({
  term,
  host,
  fit,
  send,
}: {
  term: Terminal
  host: HTMLElement
  fit: FitAddon
  send: (frame: TerminalClientFrame) => void
}): PtySizer {
  let lastSentSize: PtySize | null = null
  let ptyResizeTimer: ReturnType<typeof setTimeout> | null = null
  // Xterm's grid moved (via a per-frame fit) away from what the PTY was last told
  // AT SOME POINT during the current gesture. We need this because the debounced
  // PTY frame is deduped: if a drag shrinks the pane and then settles back at the
  // last-sent size, `planPtyResize` returns null and no SIGWINCH is sent — but
  // xterm shrinking the ALT buffer drops cells destructively (and a late re-fit can
  // land after the flush), so an alt-screen TUI (claude, vim, top) is left rendering
  // garbage until a MANUAL resize to a different size forces a repaint. When the
  // grid was dirtied we force one settling resize even at an unchanged size.
  let sizeDirty = false

  const flushPtySize = () => {
    ptyResizeTimer = null
    const next = planPtyResize(term.cols, term.rows, lastSentSize)
    if (next) {
      lastSentSize = next
      sizeDirty = false
      send({ t: 'resize', cols: next.cols, rows: next.rows })
      return
    }
    // next === null → current size equals what the PTY already knows. Only re-assert
    // (forcing the TUI to repaint) if the grid was actually mangled this gesture.
    if (sizeDirty && lastSentSize) {
      sizeDirty = false
      send({ t: 'resize', cols: lastSentSize.cols, rows: lastSentSize.rows })
    }
  }

  const sync = (immediate = false) => {
    if (ptyResizeTimer) {
      clearTimeout(ptyResizeTimer)
      ptyResizeTimer = null
    }
    if (immediate) flushPtySize()
    else ptyResizeTimer = setTimeout(flushPtySize, PTY_RESIZE_DEBOUNCE_MS)
  }

  const fitToHost = () => {
    const rect = host.getBoundingClientRect()
    if (!shouldFitHost(rect.width, rect.height)) return // hidden/collapsed → garbage fit
    try {
      fit.fit()
    } catch {
      /* not laid out yet */
    }
    if (!lastSentSize || term.cols !== lastSentSize.cols || term.rows !== lastSentSize.rows)
      sizeDirty = true
    sync()
  }

  return {
    fit: fitToHost,
    sync,
    // A fresh attach must always tell the PTY our dimensions (it may have been
    // created 80×24, or drifted while detached) → clear the dedupe.
    reset: () => {
      lastSentSize = null
    },
    dispose: () => {
      if (ptyResizeTimer) clearTimeout(ptyResizeTimer)
    },
  }
}
