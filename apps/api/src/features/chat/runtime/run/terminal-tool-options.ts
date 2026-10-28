/**
 * The `Bash` tool's interactive-terminal port: open a PTY pane, read its screen, type into
 * it, close it — the actions that let the model drive a full-screen TUI instead of only
 * running one-shot commands.
 *
 * Every capability is bound to THIS user and session at construction, so a terminal is
 * scoped and reaped with the session that opened it; agent-core never sees an unbound
 * terminal host. Absent when the profile hides `bash` or no terminal host is wired — the
 * actions then simply do not exist on the tool.
 */
import type { RunProfile } from '../../../agent-core/run-shape'
import { isToolDirect } from '../../../agent-core/run-shape'
import { TOOL } from '../../../agent-core/tool-names'
import type { CoreToolDeps } from '../../../agent-core/tool-registry'
import type { RuntimeState } from '../agent-runner-state'
import type { SessionRecord } from '../../repository'
import type { RunnerDeps } from '../agent-runner-types'
import { announcePtyOpen } from './pty-announce'

export interface TerminalToolOptionsDeps {
  deps: RunnerDeps
  userId: string
  session: SessionRecord
  /** The agent taking the turn — the owner of every pane it opens. */
  agentId: string
  agentProfile: RunProfile
  terminalWaits: RuntimeState['terminalWaits']
}

export function buildTerminalToolOptions({
  deps,
  userId,
  session,
  agentId,
  agentProfile,
  terminalWaits,
}: TerminalToolOptionsDeps): CoreToolDeps['terminalControl'] {
  const terminalControl = deps.terminalControl
  if (!isToolDirect(agentProfile, TOOL.Bash) || !terminalControl) return undefined
  return {
    // Same `terminal.opened` push as spawnTerminalJob above: an interactive
    // open must reveal its pane without waiting on the registry poll.
    open: announcePtyOpen(
      ({ cwd, command }: { cwd?: string; command: string }) =>
        terminalControl.open({ userId, sessionId: session.id, agentId, cwd, command }),
      (event) => deps.streamRegistry.publish(userId, session.id, event),
      session.id,
    ),
    screen: (terminalId) => terminalControl.screen({ userId, sessionId: session.id, terminalId }),
    finalScreen: terminalControl.finalScreen
      ? (terminalId) =>
          terminalControl.finalScreen!({
            userId,
            sessionId: session.id,
            terminalId,
          })
      : undefined,
    write: (terminalId, data) =>
      terminalControl.write({ userId, sessionId: session.id, terminalId, data }),
    watch: (terminalId, onEvent) =>
      terminalControl.watch({ userId, sessionId: session.id, terminalId }, onEvent),
    list: () => terminalControl.list({ userId, sessionId: session.id }),
    close: (terminalId) => terminalControl.close({ userId, sessionId: session.id, terminalId }),
    onWait: ({ terminalId, active, label }) => {
      if (active)
        terminalWaits.set(terminalId, {
          userId,
          sessionId: session.id,
          terminalId,
          label,
        })
      else terminalWaits.delete(terminalId)
      deps.streamRegistry.publish(userId, session.id, {
        type: 'terminal.waiting',
        sessionId: session.id,
        terminalId,
        active,
        label,
      })
    },
    onInput: ({ terminalId, label }) =>
      deps.streamRegistry.publish(userId, session.id, {
        type: 'terminal.input',
        sessionId: session.id,
        terminalId,
        source: 'agent',
        label,
      }),
  }
}
