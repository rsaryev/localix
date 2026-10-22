import { agentLaneSessionPrefix } from '../../agent-core/execution-address'

import { createSessionSnapshotCache } from './session-snapshot'
import { createRunScopeCache, type ScopeDiscovery } from './run-scope'
import { envFlag } from '../../../lib/env'
import type { FrozenSessionContext } from './agent-runner-types'
import type { BackgroundJobSnapshot } from '../../agent-core/prompt/sections/background-jobs'
import { forgetMidRunReminders } from './mid-run-reminders'
import type { WorkRegistry } from '../../work/registry'
import { createRouteCooldowns } from './route-cooldowns'
import { createActiveRuns } from './active-runs'
import type { RuntimeState } from './agent-runner-state-contracts'
export type {
  ActionRegistryEntry,
  LiveItemResolver,
  ChildRuntimeSession,
  ContextLaneState,
  RuntimeState,
} from './agent-runner-state-contracts'

/**
 * Bound the two PROCESS-LIFETIME per-lane stores (VBC state, file mtimes) as ONE unit:
 * when the cap forces an eviction, the evicted lane leaves both maps, so what the write
 * guard remembers and what the wire knows never desync. Oldest-inserted first, across
 * the union of keys.
 */
export function evictSessionStateOverCap(
  state: Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes'>,
  cap = 500,
): void {
  const maps = [state.contextLanes, state.sessionFileMtimes] as const
  while (Math.max(state.contextLanes.size, state.sessionFileMtimes.size) > cap) {
    // The oldest key of the LARGEST map — the one actually over cap.
    const over = maps.find((m) => m.size > cap)
    const oldest = over?.keys().next().value
    if (oldest === undefined) break
    state.sessionFileMtimes.get(oldest)?.dispose()
    for (const m of maps) m.delete(oldest)
  }
}

/**
 * Reap PROCESS-LIFETIME per-session entries when a session is DELETED (not
 * merely stopped — a stopped session can resume, so it keeps these). Run-scoped
 * maps (activeRuns, liveItemResolvers) are cleaned by the run's own
 * `finally`/`stop`; these otherwise survive forever, so a long-lived
 * multi-session server leaks one entry per deleted session. The wake queue lives
 * in the wake-queue manager and is reaped via its own `forget`.
 *
 * Background jobs are different: by design they outlive the run that spawned
 * them. Deleting an idle session therefore has to kill and reap its owned action
 * entries here; `stopSession` has no active run to abort in that state.
 */
export function forgetSessionRuntimeState(
  state: Pick<
    RuntimeState,
    | 'actionRegistry'
    | 'work'
    | 'pluginStartedSessions'
    | 'ccHooksStartedSessions'
    | 'ccHooksSessionStartSource'
    | 'ccHookOnceKeys'
    | 'contextSnapshots'
    | 'childRuntimeSessions'
    | 'drainingSessions'
    | 'contextLanes'
    | 'sessionFileMtimes'
    | 'midRunReminders'
    | 'sessionAutoApprovedTools'
    | 'terminalWaits'
    | 'sessionRunIdentity'
  >,
  sessionId: string,
): void {
  state.sessionRunIdentity.delete(sessionId)
  for (const [toolCallId, entry] of state.actionRegistry) {
    if (entry.sessionId !== sessionId) continue
    if (entry.lifecycle) entry.lifecycle.forgotten = true
    const kill = entry.actions.kill
    if (kill && kill.enabled !== false) {
      try {
        kill.execute()
      } catch {
        // Forget is terminal cleanup: one broken tool action cannot retain the
        // rest of the deleted session's runtime state.
      }
    }
    state.actionRegistry.delete(toolCallId)
  }
  // Also covers work whose action disposer raced or was malformed: its rows went with the cascade.
  state.work.forgetSession(sessionId)
  state.pluginStartedSessions.delete(sessionId)
  state.sessionAutoApprovedTools.delete(sessionId)
  state.ccHooksStartedSessions.delete(sessionId)
  state.ccHooksSessionStartSource.delete(sessionId)
  state.ccHookOnceKeys.delete(sessionId)
  state.contextSnapshots.invalidate(sessionId)
  state.childRuntimeSessions.delete(sessionId)
  state.drainingSessions.delete(sessionId)
  const lanePrefix = agentLaneSessionPrefix(sessionId)
  const laneKeys = new Set([...state.contextLanes.keys(), ...state.sessionFileMtimes.keys()])
  for (const key of laneKeys) {
    if (!key.startsWith(lanePrefix)) continue
    state.sessionFileMtimes.get(key)?.dispose()
    state.contextLanes.delete(key)
    state.sessionFileMtimes.delete(key)
  }
  // Drop reminders queued but never drained (the session died mid-turn).
  forgetMidRunReminders(state, sessionId)
  for (const [terminalId, wait] of state.terminalWaits) {
    if (wait.sessionId === sessionId) state.terminalWaits.delete(terminalId)
  }
}

/**
 * Snapshot a session's running work WITH its current PTY output tail + running flag — the
 * registry's owner filter, then each job's scrollback via `readTerminalJob`. Shared by the
 * runner's `getBackgroundJobsSnapshot` accessor and the per-turn `# Background jobs` prompt
 * section. The tail length is the caller's concern — this returns the raw output.
 */
export function snapshotBackgroundJobs(
  work: WorkRegistry,
  userId: string,
  sessionId: string,
  readTerminalJob?: (input: {
    userId: string
    terminalId: string
  }) => { output: string; running: boolean } | null,
): BackgroundJobSnapshot[] {
  return work.list({ userId, sessionId }).map((record) => {
    const read =
      record.terminalId && readTerminalJob
        ? readTerminalJob({ userId, terminalId: record.terminalId })
        : null
    return {
      toolCallId: record.toolCallId,
      jobId: record.displayId,
      ...(record.terminalId ? { terminalId: record.terminalId } : {}),
      command: record.label,
      startedAt: Date.parse(record.startedAt),
      output: read?.output ?? '',
      running: read?.running ?? true,
    }
  })
}

export function createRuntimeState(work: WorkRegistry): RuntimeState {
  return {
    work,
    activeRuns: createActiveRuns(),
    activeRunSessions: new Map(),
    sessionRunIdentity: new Map(),
    stoppedRuntimeSessionIds: new Set(),
    cascadeStoppedSessionIds: new Set(),
    // Sessions whose plugin onSessionStart hooks have already fired (once per
    // session, not once per turn). Process-lifetime — re-fires after a restart.
    pluginStartedSessions: new Set(),
    ccHooksStartedSessions: new Set(),
    ccHooksSessionStartSource: new Map(),
    ccHookOnceKeys: new Map(),
    // Frozen per-session context snapshot (see
    // session-snapshot.ts). Opt out with LOCALIX_FREEZE_CONTEXT=0.
    contextSnapshots: createSessionSnapshotCache<FrozenSessionContext>({
      maxEntries: 200,
      enabled: envFlag('LOCALIX_FREEZE_CONTEXT', true),
    }),
    // Bounded well below contextSnapshots on purpose: this is keyed by SCOPE, not by
    // session, and a user works in a handful of project/cwd combinations while holding
    // hundreds of sessions open.
    runScopes: createRunScopeCache<ScopeDiscovery>(32),
    // Maps toolCallId → registered actions (kill, pause, send_input, …)
    actionRegistry: new Map(),
    terminalWaits: new Map(),
    childRuntimeSessions: new Map(),
    drainingSessions: new Set(),
    liveItemResolvers: new Map(),
    tokenCalibration: new Map(),
    contextLanes: new Map(),
    sessionFileMtimes: new Map(),
    midRunReminders: new Map(),
    // Per-session "Always allow" tool set — auto-approves later confirms for the
    // same tool in a session (see field doc). In-memory: a restart re-asks.
    sessionAutoApprovedTools: new Map(),
    routeCooldowns: createRouteCooldowns(),
  }
}
