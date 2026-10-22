import type { TerminalSession } from './session'

/**
 * Session confinement for AGENT access to terminals.
 *
 * The terminal service owns terminals per USER — `ownedBy` is
 * `s?.userId === userId` — and that is right for the human: the terminal panel and the
 * RPC route let you look at any pane you own, whichever chat opened it.
 *
 * An agent is narrower. It may only touch panes bound to the session it is running in,
 * and the policy already existed in exactly one place: the `list` wiring filters on
 * `t.chatSessionId === sessionId`. The action wiring did not — `screen`, `finalScreen`,
 * `write` and `close` were passed `{ userId, terminalId }` and went straight to
 * `terminalService.get(userId, …)`. So a sub-agent, delegated task run or cron subsession
 * holding another chat's terminal id could read that pane, CLOSE it, or `write` into it —
 * typing into someone else's live `psql`/`ssh`/`vim`. `terminal.ts` describes its deps as
 * "a thin, user+session-scoped view of the terminal service", and `screen`/`write`
 * document the target as "a terminal the caller owns", which held only at user
 * granularity.
 *
 * One helper rather than the same comparison inlined four times, so the policy has a
 * single definition and a test.
 */
export function resolveAgentTerminal(input: {
  /** The user-scoped lookup the service already provides. */
  get: (userId: string, terminalId: string) => TerminalSession | undefined
  userId: string
  /** The agent's session. `null` (no owning chat) can address no terminal at all. */
  sessionId: string | null
  terminalId: string
}): TerminalSession | undefined {
  const { get, userId, sessionId, terminalId } = input
  if (!sessionId) return undefined
  const session = get(userId, terminalId)
  // Belt and braces: `get` is already user-scoped, but this helper is the one place the
  // agent's boundary is stated, so it does not lean on that.
  if (!session || session.userId !== userId) return undefined
  return session.chatSessionId === sessionId ? session : undefined
}

/**
 * The same policy, taking the service directly — the shape the wiring needs, since
 * `terminalControl` is a property inside an object literal and cannot hold a local const.
 * An absent service resolves to nothing rather than throwing: the agent tool is only
 * exposed when the service exists, and a missing one must not become an exception on the
 * permission path.
 */
export function agentTerminalOf(
  service: { get: (userId: string, terminalId: string) => TerminalSession | undefined } | undefined,
  userId: string,
  sessionId: string | null,
  terminalId: string,
): TerminalSession | undefined {
  if (!service) return undefined
  return resolveAgentTerminal({
    get: (u, t) => service.get(u, t),
    userId,
    sessionId,
    terminalId,
  })
}

/**
 * Subscribe to an agent-visible terminal's output and exit, behind the same boundary as
 * `agentTerminalOf`. Null when the pane is not this session's or no longer exists, which a reader
 * treats as an exit. Lets a reader re-read the screen when it can have changed, not on a timer.
 */
export function watchAgentTerminal(
  service: { get: (userId: string, terminalId: string) => TerminalSession | undefined } | undefined,
  input: { userId: string; sessionId: string | null; terminalId: string },
  onEvent: (event: 'output' | 'exit') => void,
): (() => void) | null {
  const session = agentTerminalOf(service, input.userId, input.sessionId, input.terminalId)
  if (!session) return null
  const offData = session.subscribe(() => onEvent('output'))
  const offExit = session.onExit(() => onEvent('exit'))
  return () => {
    offData()
    offExit()
  }
}
