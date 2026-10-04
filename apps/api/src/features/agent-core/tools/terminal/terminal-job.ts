/**
 * Capability the bash tool uses to run a background job inside a real PTY (a
 * terminal pane the user can watch and interact with) instead of a detached
 * child process. The host is injected (bootstrap wires it to the terminal
 * service) so agent-core never imports the terminal feature — the dependency
 * arrow stays one-way. Absent → the bash tool falls back to `child_process`.
 */

/** A live PTY job: observe output/exit, send input, terminate. */
export interface TerminalJobHandle {
  /** Backend terminal id — the UI attaches a pane to this to show/interact with the job. */
  terminalId: string
  onData(listener: (chunk: string) => void): void
  onExit(listener: (code: number) => void): void
  /** Fires once with the dev-server URL the job advertised in its output, if any
   *  (content-detected by the host, never from the command). Fires immediately when
   *  already known. Lets the bash tool record a lazy preview target without itself
   *  knowing how URLs are detected — the host (terminal) owns that. */
  onPreviewUrl?(listener: (url: string) => void): void
  write(data: string): void
  kill(): void
}

/**
 * Spawn a one-shot command in a PTY pane. Bound to a user + chat session by the
 * host at wiring time, so the tool only supplies the cwd + command.
 */
export type SpawnTerminalJob = (input: {
  cwd: string
  command: string
  /**
   * The job's exit wakes the agent (`bash notify`), so that turn is what reports it to the person.
   * Without the flag the host announced the exit as well, and one job left two Event Center rows:
   * "Background terminal finished" and the woken turn's "Agent run finished".
   */
  wakesAgent?: boolean
}) => Promise<TerminalJobHandle>

/**
 * A rendered view of the terminal's VISIBLE screen — the grid as a user would
 * see it, produced by a headless VT emulator. This is what lets the model read
 * full-screen TUIs (vim, htop, arrow menus), where raw scrollback is just
 * cursor-move/redraw escape soup. Defined here (the agent-core ↔ terminal
 * contract boundary) so neither side imports the other's internals.
 */
export interface ScreenSnapshot {
  /** Visible rows joined with '\n' (trailing blank rows trimmed). */
  text: string
  /** Cursor position within the viewport (0-indexed). */
  cursor: { row: number; col: number }
  cols: number
  rows: number
}

/** A terminal's current state for inspection. `null` when no live terminal has that id. */
export interface TerminalSnapshot {
  /** Current scrollback (combined stdout+stderr). */
  output: string
  /** True while the terminal/job is still live. */
  running: boolean
  /** Rendered visible screen, when a VT emulator is available. */
  screen?: ScreenSnapshot
}

/**
 * Capability the interactive `terminal` tool uses to drive a real PTY across
 * turns: open a program, read its rendered screen, send keystrokes, list, and
 * close. Bound to a user + chat session by the host at wiring time (bootstrap →
 * terminal service), so agent-core never imports the terminal feature — the
 * dependency arrow stays one-way. Absent → the tool is not registered.
 */
export interface TerminalControl {
  /** Spawn `command` in a PTY pane the user can watch/take over. Returns its id + initial screen. */
  open(input: {
    userId: string
    /** The run's session — a pane always belongs to one; there is no unbound terminal. */
    sessionId: string
    /** The participant whose run opens it — the owner its work record names. */
    agentId?: string
    cwd?: string
    command: string
  }): Promise<{ terminalId: string; screen: ScreenSnapshot | null }>
  /**
   * Render the current visible screen of a terminal bound to THIS chat session.
   *
   * `sessionId` is not decoration: the service's ownership is per-USER, so without it a
   * sub-agent or delegated task run holding another chat's terminal id read that pane. `list`
   * was session-filtered from the start and these actions were not.
   */
  screen(input: {
    userId: string
    sessionId: string | null
    terminalId: string
  }): Promise<ScreenSnapshot | null>
  /**
   * Render the final retained screen after a terminal exits. This stays separate
   * from `screen` so a closed process is never mistaken for a live terminal.
   */
  finalScreen?(input: {
    userId: string
    sessionId: string | null
    terminalId: string
  }): Promise<ScreenSnapshot | null>
  /**
   * Write raw bytes (already key-encoded) to a terminal bound to THIS chat session.
   * false → not found OR not this session's. The most consequential of the four: without
   * the session component one chat could type into another chat's live psql/ssh/vim.
   */
  write(input: {
    userId: string
    sessionId: string | null
    terminalId: string
    data: string
  }): boolean
  /**
   * Subscribe to output and exit of a terminal bound to THIS chat session; returns the
   * unsubscribe, or null when there is no such live terminal. What wakes a `wait` — the screen
   * can only change when one of these fires, so nothing re-renders it on a timer.
   */
  watch(
    input: { userId: string; sessionId: string | null; terminalId: string },
    onEvent: (event: 'output' | 'exit') => void,
  ): (() => void) | null
  /** Live terminals bound to this chat session. */
  list(input: {
    userId: string
    sessionId: string | null
  }): { terminalId: string; command?: string }[]
  /** Kill a terminal bound to THIS chat session. false → not found OR not this session's. */
  close(input: { userId: string; sessionId: string | null; terminalId: string }): boolean
}
