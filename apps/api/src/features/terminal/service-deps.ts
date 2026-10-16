/**
 * What the terminal service needs from its host, and what a caller hands it to open a pane.
 * Split from `service.ts` so the registry's behaviour and its wiring contract are read apart:
 * every member here is injected, which is how the feature stays free of chat internals.
 */
import type { PtyBackend } from './pty-backend'

export interface TerminalServiceDeps {
  backend: PtyBackend
  /**
   * Resolve the absolute cwd a new terminal should open in: the session's workspace dir,
   * REJECTING for a session the user does not own. There is no session-less default — a
   * terminal always belongs to a session (see `createTerminalRequestSchema`).
   */
  resolveCwd: (userId: string, sessionId: string) => Promise<string>
  /**
   * Login shell for interactive panes; defaults to `$SHELL`. Also used to pick
   * the shell-integration rc (bash/zsh).
   */
  shell?: string
  /**
   * Enable OSC 133 shell integration on interactive panes (per-command exit-code
   * marks + prompt navigation). Defaults to `true`; opt-out safe — an unknown
   * shell or any failure silently falls back to a plain shell.
   */
  shellIntegration?: boolean
  /** Publish chat-scoped volatile lifecycle without coupling this feature to chat internals. */
  publishLifecycle?: (
    userId: string,
    sessionId: string,
    event:
      | {
          type: 'terminal.input'
          terminalId: string
          source: 'user'
          label?: string
        }
      | {
          type: 'terminal.finished'
          terminalId: string
          cwd?: string
          exitCode: number
          command?: string
          /** When the process exited — see the contract note; a replayed frame must stay datable. */
          finishedAt?: number
          stopped?: true
          /** Why it was stopped, in plain words (`timeout 60 s`) — see the contract note. */
          stopReason?: string
          /** A login shell the person opened (`open`), not a job — see the contract note. */
          interactive?: true
          /** Its exit wakes the agent, whose turn reports it — see the contract note. */
          wakesAgent?: true
        },
  ) => void
  /**
   * Push a live pane's alt-screen / served-URL change (`terminal.state`). Separate from
   * `publishLifecycle` because that one also feeds the notification journal, and a state flip
   * is not a fact anyone is notified about.
   */
  publishState?: (
    userId: string,
    sessionId: string,
    event: {
      type: 'terminal.state'
      terminalId: string
      command?: string
      altScreen: boolean
      previewUrl?: string
    },
  ) => void
}

export interface CreateTerminalInput {
  /** The session the pane belongs to — required: an unbound pane was nobody's to list or close. */
  sessionId: string
  cwd?: string
  cols?: number
  rows?: number
}
