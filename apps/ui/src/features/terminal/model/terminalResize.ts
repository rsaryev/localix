// Pure resize policy for a terminal pane: when to fit xterm to its host and
// what (if anything) to tell the backend PTY. Extracted from TerminalPane so the
// gating/clamping rules are unit-testable without a DOM or a PTY.
//
// Why gating matters (the "TUI app went out of bounds" bug class): the xterm fit
// addon clamps its proposal to a 2×1 floor — `Math.max(2, floor(width/cell))` —
// so fitting a host that is momentarily laid out at 0px (a grid re-layout /
// maximize transition, a sash dragged to nothing) resizes xterm to 2 columns and
// forwards ~2×1 to the PTY. The SIGWINCH makes a full-screen app (claude, vim)
// reflow into garbage, and xterm's own reflow rewraps the primary-buffer
// scrollback at 2 columns DESTRUCTIVELY. A `display:none` keep-alive body is
// merely wasteful (the addon bails on NaN dims), but the transitional-0px case
// is actively harmful — so we never fit, and never talk to the PTY, unless the
// host has real, positive dimensions.

/** Never tell the PTY it is narrower/shorter than this — a TUI app given 1 row
 *  redraws unusably and some full-screen apps crash on degenerate sizes. */
export const MIN_PTY_COLS = 2
export const MIN_PTY_ROWS = 2

/** Trailing debounce for PTY resize frames. A sash drag fires ResizeObserver per
 *  frame; xterm re-fits immediately (the local view must track the drag) but the
 *  PTY hears ONE resize per settle — each SIGWINCH makes a full-screen app
 *  repaint everything, so a per-frame storm turns dragging into flicker. */
export const PTY_RESIZE_DEBOUNCE_MS = 80

export interface PtySize {
  cols: number
  rows: number
}

/** Should the pane run `fit()` (and consider a PTY resize) for a host measured at
 *  `width`×`height` CSS px? False for hidden (0 or NaN) hosts — fitting there can
 *  only produce garbage. */
export function shouldFitHost(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
}

/**
 * Decide the resize frame to send to the backend PTY after a fit, given xterm's
 * resulting dimensions and the last frame actually sent. Returns `null` when
 * nothing should be sent (dims invalid, or unchanged — a PTY resize is a
 * SIGWINCH + full TUI redraw, so duplicates are never free). Dimensions are
 * clamped to the {@link MIN_PTY_COLS}×{@link MIN_PTY_ROWS} floor so a
 * legitimately tiny-but-visible pane still keeps the PTY sane.
 */
export function planPtyResize(
  cols: number,
  rows: number,
  lastSent: PtySize | null,
): PtySize | null {
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols <= 0 || rows <= 0) return null
  const next = { cols: Math.max(MIN_PTY_COLS, cols), rows: Math.max(MIN_PTY_ROWS, rows) }
  if (lastSent && lastSent.cols === next.cols && lastSent.rows === next.rows) return null
  return next
}
