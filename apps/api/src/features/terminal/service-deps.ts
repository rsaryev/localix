/**
 * What the terminal service needs from its host, and what a caller hands it to open a pane.
 * Split from `service.ts` so the registry's behaviour and its wiring contract are read apart:
 * every member here is injected, which is how the feature stays free of chat internals.
 */
import type { PtyBackend } from './pty-backend'
import type { ListeningPort } from './port-scan'

export interface TerminalServiceDeps {
  backend: PtyBackend
  /**
   * Resolve the absolute cwd a new terminal should open in: the session's workspace dir,
   * REJECTING for a session the user does not own. There is no session-less default — a
   * terminal always belongs to a session (see `createTerminalRequestSchema`).
   */
  resolveCwd: (userId: string, sessionId: string) => Promise<string>
  /**
   * Enumerate the OS's listening TCP ports (for banner-less preview detection +
   * liveness). Injected so the service depends on the ABSTRACT scanner, not the
   * concrete OS impl — defaults to the real one; tests pass a fake.
   */
  scanListeningPorts?: () => Promise<ListeningPort[]>
  /** Reuse window for a port scan (ms). Defaults to the service's TTL; tests set 0 to force a
   *  fresh scan per call (a scan already in flight is still shared — see port-scan-cache.ts). */
  portScanTtlMs?: number
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
          exitCode: number
          command?: string
          /** When the process exited — see the contract note; a replayed frame must stay datable. */
          finishedAt?: number
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
  /**
   * Tell the liveness watcher what this service already knows about a served URL: the PTY
   * behind it exited, or its listener vanished from the port scan. It is the one place in
   * the system where a dev server's death is an EVENT rather than something to be polled
   * for, and the preview pane reacts in the same tick instead of on the next probe.
   */
  reportEndpointLiveness?: (url: string, alive: boolean) => void
}

export interface CreateTerminalInput {
  /** The session the pane belongs to — required: an unbound pane was nobody's to list or close. */
  sessionId: string
  cwd?: string
  cols?: number
  rows?: number
}
