import type { ChatRepository, SessionRecord } from '../repository'
import { whenRunReleased, type ActiveRuns } from './active-runs'
import { toSessionSummary } from '../repository'
import type { RuntimeState } from './agent-runner-state'
import { markChildStopped as markChildRuntimeStopped } from './session-status'
import type { SessionStreamRegistry } from './session-stream-registry'
import { stopSpawnedChildren, type CascadeContext } from './stop-cascade'

/**
 * Stopping a session: the run, the children it spawned, and the persisted status, in one module
 * so the three senses of "running" are handled by one reader instead of being spread across the
 * runner's API surface.
 */

const RUN_SETTLEMENT_TIMEOUT_MS = 5_000

/**
 * Wait until this exact run relinquishes the session registry slot. Woken by the registry's own
 * release announcement (`active-runs.ts`), so a stop returns as soon as the run's teardown frees
 * the slot rather than on the next tick of a re-check.
 */
export function waitForRunSettlement(
  activeRuns: ActiveRuns,
  sessionId: string,
  run: AbortController,
  timeoutMs = RUN_SETTLEMENT_TIMEOUT_MS,
): Promise<boolean> {
  return whenRunReleased(activeRuns, sessionId, run, timeoutMs)
}

/** A stop acknowledgement is truthful only after the exact run relinquishes its slot. */
export async function requireRunSettlement(
  activeRuns: ActiveRuns,
  sessionId: string,
  run: AbortController,
  timeoutMs = RUN_SETTLEMENT_TIMEOUT_MS,
): Promise<void> {
  if (await waitForRunSettlement(activeRuns, sessionId, run, timeoutMs)) return
  throw new Error(`Stop timed out while ${sessionId} was still shutting down`)
}

/** Collaborators a stop needs. All stable — no per-run state is threaded in. */
export interface StopSessionContext {
  state: RuntimeState
  repo: ChatRepository
  streamRegistry: SessionStreamRegistry
  now: () => string
  /**
   * Persist + publish a runtime-status change, resolving to the UPDATED record —
   * `markChildStopped` re-files the child under its refreshed session row, so this
   * must return it, not void.
   */
  markRuntimeSessionStatus: (
    userId: string,
    session: SessionRecord,
    status: SessionRecord['runtimeStatus'],
  ) => Promise<SessionRecord>
}

/**
 * Why a run is being stopped, which decides how much else goes with it:
 *
 *   - `operator-stop` — the person pressed Stop: the run and every child it spawned;
 *   - `replace-run` — an ordinary send supersedes the run: only the run, and no "stopped" mark;
 *   - `cancel-wake` — the wake that opened this run was withdrawn (its loop was cancelled): only the
 *     run, shown as stopped, and nothing of the session's other work — its queued turns and its
 *     sub-agents belong to other producers.
 */
export type StopSessionIntent = 'operator-stop' | 'replace-run' | 'cancel-wake'

/**
 * Stop a session. Three tiers, in order — a session can be "running" in three
 * different senses and stop must handle all of them:
 *
 *  1. A live run in this process → abort it.
 *  2. No run of its own, but it IS a sub-agent child of one → kill the child
 *     process. Never fall back to aborting the PARENT's run: the parent may be
 *     doing live, unrelated work for the user.
 *  3. Neither → the persisted row still says `running` (a job whose process is
 *     gone, or a stale row from a crash). Clear it anyway: stop must ALWAYS be able
 *     to un-stick a session in the UI.
 *
 * Returns false only when there was nothing to stop.
 */

/** Bind a cascade to this stop: the cascade decides WHO, this decides HOW. */
function cascadeFor(ctx: StopSessionContext, _userId: string): CascadeContext {
  return {
    repo: ctx.repo,
    stop: (childId, visited) => {
      // Only a child with a LIVE run reaches a run end that could read this mark; marking one
      // without would leave it for that child's next, unrelated run.
      if (ctx.state.activeRuns.has(childId)) ctx.state.cascadeStoppedSessionIds.add(childId)
      return stopSession(ctx, childId, 'operator-stop', visited)
    },
  }
}

export async function stopSession(
  ctx: StopSessionContext,
  sessionId: string,
  intent: StopSessionIntent = 'operator-stop',
  /** Sessions already visited by a cascading stop; a cycle must not hang the stop. */
  visited: Set<string> = new Set(),
): Promise<boolean> {
  const { state, repo, streamRegistry, now, markRuntimeSessionStatus } = ctx
  const {
    activeRuns,
    activeRunSessions,
    stoppedRuntimeSessionIds,
    childRuntimeSessions,
    actionRegistry,
  } = state

  const abort = activeRuns.get(sessionId)
  if (abort) {
    stoppedRuntimeSessionIds.add(sessionId)
    abort.abort()
    const active = activeRunSessions.get(sessionId)
    if (intent === 'operator-stop' && active && active.session.sessionKind !== 'chat') {
      // A resolved stop is a durable/UI acknowledgement, not merely an abort signal.
      // Await the status write before reporting success; otherwise the client can
      // immediately re-read `running` even though stop() returned true.
      await markRuntimeSessionStatus(active.userId, active.session, 'stopped')
    }
    // Pi's abort contract includes wait-for-idle. Match it at the host boundary:
    // a resolved stop means this exact run has left the registry, so an immediate
    // retry cannot race the old finalizer. Bounded to keep a broken provider from
    // hanging the control plane forever.
    await requireRunSettlement(activeRuns, sessionId, abort)
    // Teardown normally consumes this suppression marker. Clear it explicitly
    // for run replacement as well, so a hand-off can never poison the promoted
    // run if an alternate settlement path removed the registry entry first.
    if (intent === 'replace-run') stoppedRuntimeSessionIds.delete(sessionId)
    // Only an OPERATOR stop reaches the children. `replace-run` keeps the session alive —
    // a new run supersedes this one — and a detached child's report is still wanted by it,
    // so killing in-flight children on an ordinary message send would destroy work nobody
    // asked to abandon.
    if (intent === 'operator-stop' && active) {
      visited.add(sessionId)
      await stopSpawnedChildren(cascadeFor(ctx, active.userId), active.userId, sessionId, visited)
    }
    return true
  }

  const childRuntime = childRuntimeSessions.get(sessionId)
  if (childRuntime) {
    const action = actionRegistry.get(childRuntime.toolCallId)?.actions.kill
    if (action && action.enabled !== false) {
      action.execute()
    }
    // No kill action (process already gone / disposer raced): just mark the child
    // stopped.
    await markChildRuntimeStopped({
      childRuntimeSessions,
      markStatus: markRuntimeSessionStatus,
      childRuntime,
    })
    return true
  }

  // No live run/process in memory. Still clear the persisted status so the UI can
  // stop showing it as running.
  const row = await repo.getSessionRuntime(sessionId)
  if (row?.runtimeStatus !== 'running') return false
  const existing = await repo.getSession(row.userId, sessionId)
  if (!existing) return false
  const updated: SessionRecord = {
    ...existing,
    runtimeStatus: 'stopped',
    updatedAt: now(),
    lastMessageAt: now(),
  }
  await repo.updateSession(row.userId, sessionId, updated)
  if (intent === 'operator-stop') {
    // This session's own run is gone, but a child it spawned may still be running: the
    // child's lifetime is not bounded by the parent's.
    visited.add(sessionId)
    await stopSpawnedChildren(cascadeFor(ctx, row.userId), row.userId, sessionId, visited)
  }
  streamRegistry.publish(row.userId, sessionId, {
    type: 'session.updated',
    session: toSessionSummary(updated),
  })
  if (updated.parentSessionId) {
    streamRegistry.publish(row.userId, updated.parentSessionId, {
      type: 'child_session.updated',
      parentSessionId: updated.parentSessionId,
      session: toSessionSummary(updated),
    })
  }
  return true
}
