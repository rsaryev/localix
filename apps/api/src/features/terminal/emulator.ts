/**
 * Headless VT emulator: consumes a PTY's raw byte stream and renders the
 * VISIBLE screen on demand — the grid + cursor as a real terminal would show
 * it. This is what makes a full-screen TUI (vim, htop, arrow menus) legible to
 * the agent; the raw scrollback is just cursor-move/redraw escapes.
 *
 * Built on `@xterm/headless` — the same xterm.js core the UI renders with, minus
 * the DOM/renderer. Pure JS, runs under Bun. The terminal feature owns this;
 * agent-core only sees the `ScreenSnapshot` data shape (terminal-job.ts).
 */
import { Terminal } from '@xterm/headless'
import type { ScreenSnapshot } from '../agent-core/tools/terminal/terminal-job'

export type { ScreenSnapshot }

export interface HeadlessEmulator {
  /** Feed PTY output bytes into the screen model. */
  write(data: string): void
  /** Reflow to a new TTY size (keep it matched to the PTY). */
  resize(cols: number, rows: number): void
  /**
   * Snapshot the current visible viewport + cursor. ASYNC because `@xterm/headless`
   * parses `write()` on a later tick (its own docs: the buffer reflects a write only
   * AFTER the write callback fires) — so we drain the parser queue with a zero-length
   * write before reading, otherwise a snapshot taken right after feeding bytes (e.g.
   * the lazy scrollback replay in TerminalSession) reads a STALE/BLANK grid and a
   * full-screen TUI renders as an empty screen.
   */
  screen(): Promise<ScreenSnapshot>
  dispose(): void
}

export function createEmulator(cols: number, rows: number): HeadlessEmulator {
  const clampDimension = (value: number) => Math.max(2, Math.floor(value))
  const term = new Terminal({
    cols: clampDimension(cols),
    rows: clampDimension(rows),
    allowProposedApi: true,
    scrollback: 1000,
  })

  let disposeRequested = false
  let disposed = false
  let pendingWrites = 0
  let activeScreens = 0

  const maybeDispose = () => {
    if (!disposeRequested || disposed || pendingWrites > 0 || activeScreens > 0) return
    disposed = true
    term.dispose()
  }

  const enqueue = (data: string) => {
    if (disposeRequested) return
    pendingWrites += 1
    term.write(data, () => {
      pendingWrites -= 1
      maybeDispose()
    })
  }

  // Resolves once every write queued so far has been parsed into the buffer — the
  // only supported way (per the xterm docs) to know the grid is up to date.
  const drain = () =>
    new Promise<void>((resolve) => {
      pendingWrites += 1
      term.write('', () => {
        pendingWrites -= 1
        resolve()
        maybeDispose()
      })
    })

  return {
    write: enqueue,
    resize: (c, r) => {
      if (!disposeRequested) term.resize(clampDimension(c), clampDimension(r))
    },
    // xterm parses writes asynchronously. Disposing it while a screen() drain is
    // queued produces "DisposableStore already disposed" and can reject the
    // terminal tool exactly as the PTY exits. Stop accepting bytes immediately,
    // then release xterm only after every queued write and active snapshot settles.
    dispose: () => {
      disposeRequested = true
      maybeDispose()
    },
    screen: async () => {
      activeScreens += 1
      try {
        await drain()
        const buf = term.buffer.active
        const lines: string[] = []
        for (let i = 0; i < term.rows; i++) {
          // viewportY is the top of the visible region; translateToString(true)
          // trims trailing whitespace per line.
          lines.push(buf.getLine(buf.viewportY + i)?.translateToString(true) ?? '')
        }
        // Drop trailing blank rows so a small TUI doesn't pad out to full height.
        while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
        return {
          text: lines.join('\n'),
          cursor: { row: buf.cursorY, col: buf.cursorX },
          cols: term.cols,
          rows: term.rows,
          applicationCursorKeys: term.modes.applicationCursorKeysMode,
        }
      } finally {
        activeScreens -= 1
        maybeDispose()
      }
    },
  }
}
