/**
 * Agnostic PTY backend interface.
 *
 * The terminal feature is layered so the transport (ws) and session lifecycle
 * (session.ts) never touch a concrete PTY implementation — they speak only this
 * interface. The bundled implementation (`pty-bun.ts`) uses Bun's native PTY, but
 * a future ssh/docker backend can satisfy the same contract without any change
 * upstream, mirroring how `ExecutionEnvironment` abstracts command execution.
 */

export interface PtySpawnOptions {
  /** Login shell to run; defaults are the backend's concern. */
  shell?: string
  /** Absolute working directory the shell starts in. */
  cwd: string
  cols: number
  rows: number
  /** Extra env vars layered over the backend's base environment. */
  env?: Record<string, string>
  /**
   * Extra argv passed to the shell (interactive sessions only), e.g. bash's
   * `--rcfile <path>`. Lets a spawn-time concern like shell integration inject
   * an rc file without the backend knowing what it's for. Ignored when
   * {@link command} is set.
   */
  shellArgs?: string[]
  /**
   * One-shot command to run instead of an interactive shell. The PTY runs it
   * (via the shell's `-c`) and exits with the command's code — used for
   * agent-launched task panes. Absent → a normal interactive shell.
   */
  command?: string
}

/** A live pseudo-terminal handle — write input, resize, observe output/exit. */
export interface PtyHandle {
  /** Forward user keystrokes / paste to the shell's stdin. */
  write(data: string): void
  /** Resize the TTY (re-flows the shell and any full-screen app). */
  resize(cols: number, rows: number): void
  /** Subscribe to raw terminal output bytes (already decoded to a string). */
  onData(listener: (data: string) => void): void
  /** Fired once when the shell process exits. */
  onExit(listener: (exitCode: number) => void): void
  /** Terminate the shell and release the PTY. */
  kill(): void
}

/** Spawns PTYs. One implementation per execution location (local, ssh, docker…). */
export interface PtyBackend {
  spawn(options: PtySpawnOptions): PtyHandle
}
