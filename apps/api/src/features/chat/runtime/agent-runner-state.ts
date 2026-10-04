import type { AgentItemStatus, ToolAction } from '@localixai/agent/agents'
import type { CheckpointReason, TokenCalibration } from '@localixai/agent/context'
import { agentLaneSessionPrefix } from '../../agent-core/execution-address'
import type { ContextAnchorProof } from './context-token-estimate'

import { createSessionSnapshotCache } from './session-snapshot'
import { createRunScopeCache, type RunScopeCache, type ScopeDiscovery } from './run-scope'
import { envFlag } from '../../../lib/env'
import type { FrozenSessionContext } from './agent-runner-types'
import type { SessionRecord } from '../repository'
import type { BackgroundJobSnapshot } from '../../agent-core/system-prompt-sections'
import { forgetMidRunReminders } from './mid-run-reminders'
import type { RunIdentity } from './run-contract'
import type { FileMtimeStore } from '../../agent-core/tools/file/file-utils'
import type { ReadDedupStore } from '../../agent-core/tools/file/read-dedup'
import type { WorkRegistry } from '../../work/registry'
import type { SessionGrants } from './session-grants'
import { createRouteCooldowns, type RouteCooldowns } from './route-cooldowns'

/** One tool's registered actions plus the (userId, sessionId) that registered them. */
export interface ActionRegistryEntry {
  userId: string
  sessionId: string
  actions: Record<string, ToolAction>
  /** Shared with the originating async registry so session deletion can suppress
   * a process's inevitable late final emit after issuing its kill action. */
  lifecycle?: { forgotten: boolean }
}

/**
 * Patch the item a LIVE run holds. Answers whether it applied: false means the run no longer
 * owns the item (its row was split off at a steering point), and the caller writes the stored
 * row instead — which the run will not write again.
 */
export type LiveItemResolver = (patch: { status?: AgentItemStatus; details?: unknown }) => boolean

export interface ChildRuntimeSession {
  userId: string
  parentSessionId: string
  toolCallId: string
  session: SessionRecord
}

/**
 * Per-agent-lane memory of what the model's wire holds, carried across the lane's runs.
 *
 * The VIEW itself is durable (the checkpoint and turn contexts in `agent_message_model_context`);
 * what lives here is only process-local bookkeeping about the wire actually sent, which a
 * restart may lose without changing a single byte of the next view.
 */
export interface ContextLaneState {
  /**
   * Process-local proof for the newest usage anchor. Missing after restart by
   * design: an unproven persisted token count falls back to full estimation.
   */
  contextAnchorProof?: ContextAnchorProof
  /**
   * The per-request policy had to prune inside a run, so the measured size of that run no
   * longer describes the history the next turn rebuilds: take a checkpoint then.
   */
  checkpointDue?: CheckpointReason
  /**
   * `tool_call_id`s whose results are no longer intact on the wire (elided / crushed /
   * truncated). Collected from the wire we actually send; the wire prune reads it back
   * as its elision RATCHET, and `read` consults it so its "scroll up to that earlier
   * read" stub is never a lie. Grows monotonically.
   */
  elidedToolCallIds: Set<string>
  /**
   * The ARG half of the ratchet: ids whose heavy mutate ARGUMENTS (write content /
   * patch body) were already sent elided. Separate from `elidedToolCallIds` because
   * the meanings differ — that one states the RESULT is gone (read's stub consults
   * it); merging would force-pointer results that were never elided.
   */
  elidedArgToolCallIds: Set<string>
  /**
   * `tool_call_id`s of every tool result PRESENT on the last wire actually sent —
   * replaced wholesale per request (not monotone; presence is a statement about now).
   * `elidedToolCallIds` alone cannot answer "does the model still have that result?":
   * a message REMOVED outright (a checkpoint evicts its turn, `/clear` cuts it) never
   * carried an elision marker, so its id never entered the elided set —
   * and `read`'s "unchanged since your earlier read — scroll up" stub kept pointing at
   * content the model provably no longer has, on every repeat, forever. Intact =
   * present here AND not in `elidedToolCallIds`.
   */
  wireResultIds: Set<string>
}

/**
 * "Does the model still have that tool result, verbatim?" — the predicate behind `read`'s
 * unchanged-file stub. Elided means EITHER marker-elided on the wire OR absent from the
 * last wire entirely (a checkpoint evicted it, `/clear` cut it). No state yet — no run,
 * no request — is the safe answer: elided, re-send the full content.
 */
export function isWireResultElided(
  lane: ContextLaneState | undefined,
  toolCallId: string,
): boolean {
  if (!lane) return true
  return !lane.wireResultIds.has(toolCallId) || lane.elidedToolCallIds.has(toolCallId)
}

/**
 * Bound the three PROCESS-LIFETIME per-session stores (VBC state, file mtimes, read
 * dedup) as ONE unit: when the cap forces an eviction, the evicted session leaves all
 * three maps. They used to evict independently (each map its own oldest-inserted key),
 * and a session surviving in `sessionReadDedup` after losing its `contextLanes` entry
 * had its read stub consult EMPTY elision state — mostly defused by the wire-intact
 * predicate above (missing state reads as "elided" → safe full re-send), but a desync
 * between "what read remembers" and "what the wire knows" is never the intent.
 * Oldest-inserted first, across the union of keys.
 */
export function evictSessionStateOverCap(
  state: Pick<RuntimeState, 'contextLanes' | 'sessionFileMtimes' | 'sessionReadDedup'>,
  cap = 500,
): void {
  const maps = [state.contextLanes, state.sessionFileMtimes, state.sessionReadDedup] as const
  while (
    Math.max(state.contextLanes.size, state.sessionFileMtimes.size, state.sessionReadDedup.size) >
    cap
  ) {
    // The oldest key of the LARGEST map — the one actually over cap.
    const over = maps.find((m) => m.size > cap)
    const oldest = over?.keys().next().value
    if (oldest === undefined) break
    state.sessionFileMtimes.get(oldest)?.dispose()
    state.sessionReadDedup.get(oldest)?.dispose()
    for (const m of maps) m.delete(oldest)
  }
}

export interface RuntimeState {
  activeRuns: Map<string, AbortController>
  activeRunSessions: Map<string, { userId: string; session: SessionRecord; agentId?: string }>
  /**
   * sessionId → the run identity (role profile, tool grants, scoped hooks) a
   * dispatcher resolved for a job/subagent session, so a wake landing on that session
   * later runs as the same role (see run-params.ts). Chat sessions are never
   * recorded here. Reaped on session delete.
   */
  sessionRunIdentity: Map<string, RunIdentity>
  stoppedRuntimeSessionIds: Set<string>
  /**
   * Children whose live run was stopped BY a parent's cascading stop, not on their own. Read (and
   * cleared) at the run's end: the parent's stop is the fact the person made, and one "Sub-agent
   * stopped" row per child it took down was noise (`notifications/producers/runs.ts`).
   */
  cascadeStoppedSessionIds: Set<string>
  pluginStartedSessions: Set<string>
  /** Sessions whose CC-hook `SessionStart` already fired (once per session, like plugins). */
  ccHooksStartedSessions: Set<string>
  /**
   * The `source` the NEXT CC-hook `SessionStart` should report for a session
   * (CC values: `startup` | `resume` | `clear` | `compact`). Set to `clear` after
   * `/clear` and `compact` after a context checkpoint — both also drop the session
   * from {@link ccHooksStartedSessions} so SessionStart re-fires on the next run and
   * injects its context. Absent ⇒ `startup`. Consumed-and-cleared on fire.
   */
  ccHooksSessionStartSource: Map<string, string>
  /**
   * Per-session keys of CC-hook handlers declaring `once: true` that already ran
   * (sessionId → Set<handlerKey>). Owned here so `once` de-dup survives across the
   * per-run {@link createCcHooksRuntime} instances. Reaped on session delete.
   */
  ccHookOnceKeys: Map<string, Set<string>>
  contextSnapshots: ReturnType<typeof createSessionSnapshotCache<FrozenSessionContext>>
  /**
   * Scope-level discovery results (enabled plugins, filesystem skills, agent providers,
   * project context files) shared by every run in one (user, project, cwd) scope — which
   * is exactly a parent and the children that inherit its directory. Runner-level, not
   * run-scoped, because sharing it ACROSS runs is the entire point. See run-scope.ts.
   */
  runScopes: RunScopeCache<ScopeDiscovery>
  /**
   * toolCallId → the tool's interactive actions (kill / send_input / …), TAGGED
   * with the owner that registered them.
   *
   * The owner rides the entry itself because this map is process-wide and reachable
   * from the `interact` RPC, which carries only a toolCallId — no session. The gate
   * used to source the owner from `backgroundJobs`, a strict SUBSET of this map
   * (only kill+send_input / declared background streams land there), so every
   * kill-only registrant — foreground bash, a CLI-agent child, a delegate — had no
   * owner record and the gate degraded to allow-all. An entry cannot exist without
   * its owner now, which is what makes the gate total.
   */
  actionRegistry: Map<string, ActionRegistryEntry>
  /**
   * The session's background work — jobs, monitors, streams — behind ONE owner filter
   * (`features/work`). Process-wide like the action registry, so every read goes through
   * `work.list(owner)` / `work.resolve(owner, id)`, never the raw index.
   */
  work: WorkRegistry
  /** Active interactive-terminal waits keyed by terminal id; reconnect snapshot source. */
  terminalWaits: Map<
    string,
    { userId: string; sessionId: string; terminalId: string; label?: string }
  >
  childRuntimeSessions: Map<string, ChildRuntimeSession>
  /** Serializes wake-queue drains per session (the queues live in the wake-queue manager). */
  drainingSessions: Set<string>
  /**
   * Generic live-item resolver registry: maps a toolCallId to a callback that
   * patches the in-memory payload of the run that holds the tool item — a
   * terminal status, or late details — and persists+publishes the result.
   *
   * Populated when a tool's outcome lands after its call returned: an item left
   * `running` pending an async child (keyed by the child's `sourceToolCallId`),
   * or a queued question answered while its run still goes. Consumed by
   * `resolveParentToolItem` when the child reaches a terminal state while the
   * parent run is still alive — avoids a write-ordering race with the run's
   * own `persistAndPublish` calls. Deregistered in the parent run's `finally`
   * block so a late/duplicate child terminal falls back to the DB-walk path.
   */
  liveItemResolvers: Map<string, LiveItemResolver>
  /**
   * What each model has taught about the byte heuristic, keyed `providerId/modelId`. Learned
   * from every measured request (`token-calibration.ts`), read at the next run's request
   * policy. Process-lived (not persisted); a restart starts over.
   */
  tokenCalibration: Map<string, TokenCalibration>
  /**
   * Per-AgentLane wire bookkeeping, keyed by `agentLaneKey`. See `ContextLaneState` — created per
   * lane by `run/session-stores.ts`, bounded by `evictSessionStateOverCap`, reaped on session delete.
   */
  contextLanes: Map<string, ContextLaneState>
  /**
   * Per-AgentLane read/write bookkeeping, keyed by `agentLaneKey`. A colleague's read must
   * not unlock blind overwrite or update the version this agent actually saw.
   * Same 500-entry bound as the paired VBC and read-dedup stores.
   */
  sessionFileMtimes: Map<string, FileMtimeStore>
  /** Per-AgentLane `read` repeat-read dedup, keyed by `agentLaneKey`, spanning runs. */
  sessionReadDedup: Map<string, ReadDedupStore>
  /**
   * Facts that became true while the agent was mid-turn (a background job
   * finishing), queued per session and drained at the agent loop's tool-result
   * seam. See mid-run-reminders.ts for why neither the per-run reminders nor
   * `wake` can carry these. Shared across users/sessions like the maps above, so
   * writers must already own the session.
   */
  midRunReminders: Map<string, string[]>
  /** "This session" permission grants, per requester — see `session-grants.ts`. */
  sessionAutoApprovedTools: SessionGrants
  /**
   * Exhausted provider routes, keyed by route rather than session (see route-cooldowns.ts).
   * Set by a rate-limited failure (run/finalize.ts); read by the loop gate so a scheduled
   * fire does not burn an exhausted quota (28 of 37 failures in the largest measured session).
   */
  routeCooldowns: RouteCooldowns
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
    | 'sessionReadDedup'
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
  const laneKeys = new Set([
    ...state.contextLanes.keys(),
    ...state.sessionFileMtimes.keys(),
    ...state.sessionReadDedup.keys(),
  ])
  for (const key of laneKeys) {
    if (!key.startsWith(lanePrefix)) continue
    state.sessionFileMtimes.get(key)?.dispose()
    state.sessionReadDedup.get(key)?.dispose()
    state.contextLanes.delete(key)
    state.sessionFileMtimes.delete(key)
    state.sessionReadDedup.delete(key)
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
    activeRuns: new Map(),
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
    sessionReadDedup: new Map(),
    midRunReminders: new Map(),
    // Per-session "Always allow" tool set — auto-approves later confirms for the
    // same tool in a session (see field doc). In-memory: a restart re-asks.
    sessionAutoApprovedTools: new Map(),
    routeCooldowns: createRouteCooldowns(),
  }
}
