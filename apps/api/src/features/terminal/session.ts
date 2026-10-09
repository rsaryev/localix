/**
 * A single terminal session: owns one PTY, keeps a bounded scrollback so a
 * reconnecting client can repaint, and fans output out to attached subscribers.
 * Transport-agnostic — the terminal service and attached clients use this surface.
 */
import type { PtyHandle } from './pty-backend'
import type { TerminalSessionInfo, TerminalSessionOptions } from './session-contracts'
export type { TerminalSessionInfo } from './session-contracts'
import { createEmulator, type HeadlessEmulator } from './emulator'
import { createAltScreenTracker } from './alt-screen'
import { TerminalScrollback } from './session-scrollback'
import type { ScreenSnapshot } from '../agent-core/tools/terminal/terminal-job'
import {
  createServedUrlScanner,
  type ServedUrlScanner,
} from '../agent-core/tools/preview/served-url-detect'

export class TerminalSession {
  readonly id: string
  readonly userId: string
  readonly cwd: string
  readonly createdAt: number
  readonly command?: string
  readonly chatSessionId?: string | null

  private readonly pty: PtyHandle
  // Called once when the PTY dies or the session is disposed — used to remove the
  // shell-integration temp rc dir. Idempotent by contract.
  private readonly cleanup?: () => void
  private readonly subscribers = new Set<(data: string) => void>()
  private exitListeners = new Set<(code: number) => void>()
  // Served-URL detection: the dev-server URL this job advertised (once seen), the
  // listeners waiting for it, and a bounded scan buffer accumulating output until a
  // URL is found (then freed). The session is the SINGLE owner of this detection —
  // both the UI "Open preview" job action and the agent's lazy auto-open read it.
  private previewUrl?: string
  private previewUrlListeners = new Set<(url: string) => void>()
  private readonly urlScanner: ServedUrlScanner = createServedUrlScanner()
  private readonly scrollback = new TerminalScrollback()
  private exited = false
  exitCode: number | null = null
  /**
   * Completes the session exactly once, whether the PTY reports a natural exit or
   * its owner explicitly disposes it. Some PTY backends do not deliver `onExit`
   * after `kill()` (and others deliver it synchronously), so cleanup and the
   * server lifecycle callback cannot safely depend on that callback alone.
   */
  private readonly finish: (code: number) => void
  /** See the constructor's `onStateChange`. */
  private readonly onStateChange?: (id: string) => void
  // Alt-screen tracking + output recency — server-side liveness signals for
  // clients that are NOT attached (a tab-less PTY running a full-screen app).
  private readonly altTracker = createAltScreenTracker()
  private lastOutputAt: number
  // Current TTY size — retained so a lazily-created emulator matches the PTY.
  private cols: number
  private rows: number
  // VT emulator for rendered-screen snapshots. Built lazily on first screen()
  // (most terminals are dev-server log tails that never need a grid render).
  private emulator?: HeadlessEmulator
  private emulatorUnsub?: () => void
  /** The last parsed grid, captured before teardown rather than reconstructed from clipped replay. */
  private finalSnapshot?: Promise<ScreenSnapshot | null>

  constructor(args: TerminalSessionOptions) {
    this.id = args.id
    this.userId = args.userId
    this.cwd = args.cwd
    this.createdAt = Date.now()
    this.command = args.command
    this.chatSessionId = args.chatSessionId
    this.cols = args.cols
    this.rows = args.rows
    this.cleanup = args.cleanup
    this.onStateChange = args.onStateChange
    this.lastOutputAt = Date.now()
    this.finish = (code) => {
      if (this.exited) return
      this.exited = true
      this.exitCode = code
      // The replay cap can have evicted mode changes or earlier TUI paints. Drain the
      // existing parser before disposal so the archive retains what was actually visible.
      this.finalSnapshot = this.emulator?.screen().catch(() => null)
      // Subscriber/temporary-file cleanup is advisory. A single faulty callback
      // must not strand the PTY in the registry or prevent the remaining exit
      // observers from settling (notably terminal.finished publication).
      for (const listener of this.exitListeners) {
        try {
          listener(code)
        } catch {}
      }
      this.exitListeners.clear()
      this.emulatorUnsub?.()
      this.emulator?.dispose()
      this.emulator = undefined
      this.subscribers.clear()
      this.previewUrlListeners.clear()
      try {
        this.cleanup?.()
      } catch {}
      args.onExit(this.id, code)
    }

    this.pty = args.backend.spawn({
      cwd: args.cwd,
      cols: args.cols,
      rows: args.rows,
      command: args.command,
      shell: args.shell,
      shellArgs: args.shellArgs,
      env: args.env,
    })
    this.pty.onData((data) => {
      this.scrollback.append(data)
      this.lastOutputAt = Date.now()
      const wasAlt = this.altTracker.altScreen
      const altFlipped = this.altTracker.push(data) !== wasAlt
      if (this.scanForPreviewUrl(data) || altFlipped) this.notifyState()
      for (const s of this.subscribers) s(data)
    })
    this.pty.onExit((code) => {
      this.finish(code)
    })
  }

  get info(): TerminalSessionInfo {
    return {
      id: this.id,
      userId: this.userId,
      cwd: this.cwd,
      createdAt: this.createdAt,
      command: this.command,
      chatSessionId: this.chatSessionId,
      previewUrl: this.previewUrl,
      altScreen: this.altTracker.altScreen,
      lastOutputAt: this.lastOutputAt,
    }
  }

  /** Feed freshly-arrived output to the streaming URL scanner (newline-finalized,
   *  ANSI-safe, host-scored). The scanner returns a URL only when the best
   *  advertised origin first appears or IMPROVES (a higher-scored host shows up
   *  later) — we latch the newest best and notify waiters once. True when it changed. */
  private scanForPreviewUrl(data: string): boolean {
    const url = this.urlScanner.push(data)
    if (!url || url === this.previewUrl) return false
    this.latchPreviewUrl(url)
    return true
  }

  private latchPreviewUrl(url: string): void {
    const first = this.previewUrl === undefined
    this.previewUrl = url
    if (first) {
      for (const l of this.previewUrlListeners) l(url)
      this.previewUrlListeners.clear()
    }
  }

  /** Advisory, like the exit listeners: a faulty publisher must not break the output pipe. */
  private notifyState(): void {
    if (this.exited) return
    try {
      this.onStateChange?.(this.id)
    } catch {}
  }

  /** Force the job's served URL (the OS port scanner's ground truth — used when the
   *  process advertised no banner, or to correct a banner against the real
   *  listener). No-op if a banner already produced the same URL. Notifies waiters
   *  on the first time any URL is known. */
  setPreviewUrl(url: string): void {
    if (url === this.previewUrl) return
    this.latchPreviewUrl(url)
    this.notifyState()
  }

  /** Forget the served URL (the OS scan shows the port is no longer listening). */
  clearPreviewUrl(): void {
    if (this.previewUrl === undefined) return
    this.previewUrl = undefined
    this.notifyState()
  }

  /** Notify when this job's served URL is detected. Fires IMMEDIATELY if already
   *  known (so a late subscriber never misses it), else once on first detection.
   *  Single-shot — a server's URL is latched, so there's nothing further to emit. */
  onPreviewUrl(listener: (url: string) => void): void {
    if (this.previewUrl) listener(this.previewUrl)
    else this.previewUrlListeners.add(listener)
  }

  /** Retained output a freshly-attached client should repaint before live data. */
  get replay(): string {
    return this.scrollback.replay
  }

  /**
   * Render the visible screen via a VT emulator — lets the agent read
   * full-screen TUIs (vim/htop/menus) where raw scrollback is escape soup.
   * Built lazily: on first call we replay the retained scrollback into a fresh
   * emulator, then keep it fed off the same output pipe every pane already uses.
   */
  async screen(): Promise<ScreenSnapshot> {
    if (this.finalSnapshot) {
      const final = await this.finalSnapshot
      if (final) return final
    }
    if (!this.emulator) {
      this.emulator = createEmulator(this.cols, this.rows)
      // If a full-screen TUI is CURRENTLY on the alternate buffer, prepend the
      // alt-screen enter: the retained scrollback is a code-unit-capped slice that may
      // have dropped the original DECSET 1049 (a long-running TUI emits far more
      // than the cap), and replaying incremental cursor-moves onto the PRIMARY
      // buffer renders as overlapping garbage. Re-entering is idempotent (last
      // enter/leave wins), so this is safe even when the slice kept the original.
      if (this.altTracker.altScreen) this.emulator.write('\x1b[?1049h')
      this.emulator.write(this.scrollback.replay)
      if (!this.exited) this.emulatorUnsub = this.subscribe((data) => this.emulator?.write(data))
    }
    const snapshot = this.emulator.screen()
    if (this.exited) {
      // No live observer created a grid before exit. Reconstruct once and release the
      // parser after its drain; repeated archive reads reuse the bounded snapshot.
      this.finalSnapshot = snapshot.catch(() => null)
      this.emulator.dispose()
      this.emulator = undefined
    }
    return snapshot
  }

  write(data: string): void {
    if (!this.exited) this.pty.write(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.emulator?.resize(cols, rows)
    if (!this.exited) this.pty.resize(cols, rows)
  }

  /** Attach an output subscriber; returns an unsubscribe. */
  subscribe(listener: (data: string) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  onExit(listener: (code: number) => void): () => void {
    this.exitListeners.add(listener)
    return () => this.exitListeners.delete(listener)
  }

  dispose(): void {
    if (this.exited) return
    // 130 is the conventional shell status for an intentionally interrupted
    // process. Publish before kill: kill() may omit, delay, or synchronously emit
    // onExit depending on the PTY backend; `finish` makes every path idempotent.
    try {
      this.finish(130)
    } finally {
      // The registry callback is application code and can still throw. Killing
      // the owned process is non-optional even when server-side settlement fails.
      this.pty.kill()
    }
  }
}
