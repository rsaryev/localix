import type { PtyBackend } from './pty-backend'

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

/** PTY launch configuration and lifecycle callbacks owned by one terminal session. */
export interface TerminalSessionOptions {
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
}
