/**
 * The chat ⇄ monitor bridge — the two places a chat session touches the monitor service beyond
 * the `bash until` tool: the person's Stop, and the reap when a session is deleted.
 *
 * Sibling of `loop-ops.ts`, and for the same reason: the service is bound at boot
 * (`monitors/runtime-binding`) and is null before that and in tests. What a monitor has seen is
 * not read here — it is a field of its work record, which the read model already lists.
 *
 * One difference from loops worth stating: cancelling a monitor does NOT abort the in-flight
 * run. A loop IS the turn — cancelling it while its wake burns turns is the point. A monitor
 * only feeds the turn; killing the watch while the agent works on what it reported would
 * throw away the work the report caused.
 */
import { getMonitorService } from '../../monitors/runtime-binding'

/**
 * Stop one monitor on the user's behalf (its work row's Stop button). Not through the tool's own
 * action: a wait resumed after a restart has no live tool call to register one.
 */
export function stopSessionMonitor(userId: string, sessionId: string, monitorId: string): boolean {
  return getMonitorService()?.stop(userId, sessionId, monitorId) ?? false
}

/** Reap a deleted session's monitors so no watch is left running against a session that is gone. */
export function stopSessionMonitors(sessionId: string): void {
  getMonitorService()?.stopAllForSession(sessionId)
}
