import { recordClientFact } from './clientFacts'
import { registerNotificationCommand } from './commandRegistry'
import { sendProblemToAgent } from './agentHandoff'
import {
  continueFailedRun,
  failedRunOf,
  retryFailedRun,
  type RetryFailedRunDeps,
} from './runLifecycle'
import { useNotificationsStore } from './store'

/**
 * The owners of the journal's serializable COMMANDS. A row stores only a command name
 * (`retry_run`, `send_to_agent`), because a callback cannot survive a reload or cross from the
 * server; the handler that gives it meaning is registered here, in the window that can act.
 */

/** A retry's outcome joins the same journal as the original failure, filed under its chat. */
const reportRetry: RetryFailedRunDeps['report'] = (severity, title, body, run) =>
  void recordClientFact({
    severity,
    title,
    body,
    origin: { kind: 'session', sessionId: run.sessionId, projectId: run.projectId },
    nativeKind: 'run',
  })

export interface NotificationCommandHost {
  /** The host's regenerate (the chat paints the run as started); the server decides if it may. */
  regenerate?: RetryFailedRunDeps['regenerate']
}

export function startNotificationCommandHandlers(host: NotificationCommandHost = {}): () => void {
  const stop = [
    // The run comes from the row itself, so a Retry offered by the server — or found after a
    // reload — works the same as one offered a second ago.
    registerNotificationCommand('retry_run', async ({ entry, action }) => {
      const run = failedRunOf(entry, action)
      if (!run) return
      await retryFailedRun(run, {
        report: reportRetry,
        ...(host.regenerate ? { regenerate: host.regenerate } : {}),
        settle: (reason) => useNotificationsStore.getState().settle(entry.id, reason),
      })
    }),
    // Continue: the reply that did not finish is picked up where it stopped (rows written before
    // Continue still carry `retry_run` above, and keep working).
    registerNotificationCommand('continue_run', async ({ entry, action }) => {
      const run = failedRunOf(entry, action)
      if (!run) return
      await continueFailedRun(run, {
        report: reportRetry,
        settle: (reason) => useNotificationsStore.getState().settle(entry.id, reason),
      })
    }),
    // A COMMAND, not a callback: a problem you come back to tomorrow is exactly when handing it
    // to the agent is most useful.
    registerNotificationCommand('send_to_agent', ({ entry }) => sendProblemToAgent(entry)),
  ]
  return () => stop.forEach((dispose) => dispose())
}
