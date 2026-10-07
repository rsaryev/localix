/**
 * A single terminal session: owns one PTY, keeps a bounded scrollback so a
 * reconnecting client can repaint, and fans output out to attached subscribers.
 * Transport-agnostic — `ws.ts` is the only caller and speaks just this surface.
 */
import type { PtyBackend, PtyHandle } from './pty-backend'
import { createEmulator, type HeadlessEmulator } from './emulator'
import { createAltScreenTracker } from './alt-screen'
import type { ScreenSnapshot } from '../agent-core/tools/terminal/terminal-job'
import {
  createServedUrlScanner,
  type ServedUrlScanner,
} from '../agent-core/tools/preview/served-url-detect'

/** Cap on retained scrollback UTF-16 code units — enough to repaint a reconnect, bounded so
 *  a long-lived session can't grow without limit. */
const SCROLLBACK_LIMIT = 256 * 1024

export interface TerminalSessionInfo {
  id: string
  userId: string
  cwd: string
  createdAt: number
  /** The one-shot command this pane runs, when agent-launched (vs an interactive shell). */
  command?: string
  /** The chat session this pane is bound to, so it can be reaped when that session is deleted. */
  chatSessionId?: string | null
  /** The dev-server URL this job advertised in its output, once detected (content-
   *  based, never from the command). Lets the UI offer "Open preview" on the job and
   *  the agent lazily auto-open it. Undefined until/unless a localhost URL is seen. */
  previewUrl?: string
  /** True while the PTY sits on the ALTERNATE screen buffer — a full-screen TUI
   *  app (claude, vim, htop) is running. Lets the UI auto-reveal a tab-less
   *  terminal that something interactive just took over. */
  altScreen: boolean
  /** Epoch ms of the most recent PTY output ('recently active' signals). */
  lastOutputAt: number
}

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
  /**
   * Retained scrollback, held as the CHUNKS it arrived in rather than one string.
   *
   * It used to be `scrollback = (scrollback + data).slice(-LIMIT)`, run on every PTY
   * chunk — so once the buffer was full, each chunk copied the whole 256 KB twice, and
   * a PTY delivers chunks the size of its read buffer, not the size of the output. On a
   * measured real trace (`ls -R apps`: 12,942 chunks) that was 74.8 ms of copying for
   * one command, on the API's event loop, where it blocks every other request. The ring
   * below is 1.3 ms for the same trace and retains byte-identical content; the join is
   * paid once, by the reconnect that actually reads it.
   */
  private scrollbackChunks: string[] = []
  private scrollbackBytes = 0
  /** Memoized join of {@link scrollbackChunks}; invalidated by each new chunk. */
  private scrollbackJoined: string | null = ''
  private exited = false
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

  constructor(args: {
    id: string
    userId: string
    cwd: string
    cols: number
    rows: number
    backend: PtyBackend
    onExit: (id: string, code: number) => void
    /** One-shot command to run instead of an interactive shell (agent task panes). */
    command?: string
    /** Chat session this pane belongs to (reaped on that session's deletion). */
    chatSessionId?: string | null
    /** Shell to run (interactive panes) — resolved with shell integration. */
    shell?: string
    /** Extra shell argv (e.g. `--rcfile`) from shell integration. */
    shellArgs?: string[]
    /** Extra env (e.g. `ZDOTDIR`) from shell integration. */
    env?: Record<string, string>
    /** Removes any shell-integration temp files; called on exit + dispose. */
    cleanup?: () => void
    /**
     * Called when `info.altScreen` or `info.previewUrl` changes. Without it the only way to
     * learn a takeover or a served URL was the client's registry poll, seconds late.
     */
    onStateChange?: (id: string) => void
  }) {
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
      this.retainScrollback(data)
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

  /**
   * Append one PTY chunk to the retained scrollback, trimming the oldest bytes past the
   * cap. Trimming is by CODE UNITS, and the oldest surviving chunk is cut mid-string
   * when it straddles the boundary. A cut through a surrogate pair also drops its
   * orphaned low surrogate, so reconnect receives a valid Unicode tail.
   */
  private retainScrollback(data: string): void {
    this.scrollbackChunks.push(data)
    this.scrollbackBytes += data.length
    const trimmed = this.scrollbackBytes > SCROLLBACK_LIMIT
    while (this.scrollbackBytes > SCROLLBACK_LIMIT) {
      const oldest = this.scrollbackChunks[0] as string
      const excess = this.scrollbackBytes - SCROLLBACK_LIMIT
      if (oldest.length <= excess) {
        this.scrollbackChunks.shift()
        this.scrollbackBytes -= oldest.length
      } else {
        this.scrollbackChunks[0] = oldest.slice(excess)
        this.scrollbackBytes -= excess
      }
    }
    // A code-unit cap can bisect a supplementary character, including across chunks.
    // Drop the orphaned low surrogate too; the retained tail stays within the cap.
    const first = this.scrollbackChunks[0]
    const firstCode = first?.charCodeAt(0)
    if (trimmed && firstCode !== undefined && firstCode >= 0xdc00 && firstCode <= 0xdfff) {
      if (first.length === 1) this.scrollbackChunks.shift()
      else this.scrollbackChunks[0] = first.slice(1)
      this.scrollbackBytes -= 1
    }
    this.scrollbackJoined = null
  }

  /** The retained scrollback as one string, joined at most once per new chunk. */
  private get scrollback(): string {
    this.scrollbackJoined ??= this.scrollbackChunks.join('')
    return this.scrollbackJoined
  }

  /** Retained output a freshly-attached client should repaint before live data. */
  get replay(): string {
    return this.scrollback
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
      // alt-screen enter: the retained scrollback is a byte-capped slice that may
      // have dropped the original DECSET 1049 (a long-running TUI emits far more
      // than the cap), and replaying incremental cursor-moves onto the PRIMARY
      // buffer renders as overlapping garbage. Re-entering is idempotent (last
      // enter/leave wins), so this is safe even when the slice kept the original.
      if (this.altTracker.altScreen) this.emulator.write('\x1b[?1049h')
      this.emulator.write(this.scrollback)
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
