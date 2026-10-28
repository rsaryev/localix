/**
 * The chat ⇄ session-loop bridge — every place a chat session touches the loop
 * engine (`/loop`), in one module.
 *
 * The engine itself lives in `features/loops` and is bound at boot; chat reaches
 * it through `getLoopEngine()`, which is null until then (and in tests). The
 * knowledge that lives here is what a CHAT session expects of that engine and
 * nothing else does:
 *
 *   - a session's loops are RUNTIME state overlaid on the read model, so the session
 *     list has to be enriched with them on every read or a reload drops the loop strip;
 *   - deleting a session must reap its loops, or an orphan loop keeps firing at a
 *     session that is gone.
 *
 * Cancelling a loop withdraws the wake it has in flight — and only that one — inside the
 * loop service. It used to stop the whole session here, which took every agent's
 * queued turns and killed sub-agents the loop had nothing to do with.
 */
import { getLoopEngine } from '../../loops/runtime-binding'
import { toLoopSummary } from '../../loops/contracts'
import type { SessionLoopSummary } from '../contracts'

/** Cancel an active session loop by id. True when it was found and ended. */
export async function cancelSessionLoop(userId: string, loopId: string): Promise<boolean> {
  return (await getLoopEngine()?.cancel(loopId, userId)) ?? false
}

/**
 * Fire a session loop immediately — an EXTRA occurrence that does NOT consume a
 * fixed loop's cron slot. The wake queues behind any in-flight run. Returns true
 * when the loop exists and the fire was enqueued.
 */
export async function runSessionLoop(userId: string, loopId: string): Promise<boolean> {
  const engine = getLoopEngine()
  if (!engine) return false
  const res = await engine.runNow(loopId, userId)
  return !('error' in res)
}

/** A session's active loops — runtime state, never a DB row. */
export function listSessionLoops(userId: string, sessionId: string): SessionLoopSummary[] {
  const engine = getLoopEngine()
  if (!engine) return []
  return engine.list(userId, sessionId).map(toLoopSummary)
}

/** Reap a deleted session's loops so none is left firing at a session that is gone. */
export async function cancelSessionLoops(sessionId: string): Promise<void> {
  getLoopEngine()?.cancelForSession(sessionId)
}
