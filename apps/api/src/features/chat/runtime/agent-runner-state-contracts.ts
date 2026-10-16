/** Type-only contracts for process-lived runner registries and per-lane wire bookkeeping. */
import type { AgentItemStatus, ToolAction } from '@localixai/agent/agents'
import type { CheckpointReason, TokenCalibration } from '@localixai/agent/context'
import type { ContextAnchorProof } from './context-token-estimate'
import type { createSessionSnapshotCache } from './session-snapshot'
import type { RunScopeCache, ScopeDiscovery } from './run-scope'
import type { FrozenSessionContext } from './agent-runner-types'
import type { SessionRecord } from '../repository'
import type { RunIdentity } from './run-contract'
import type { FileMtimeStore } from '../../agent-core/tools/file/file-utils'
import type { WorkRegistry } from '../../work/registry'
import type { SessionGrants } from './session-grants'
import type { RouteCooldowns } from './route-cooldowns'

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
   * as its elision RATCHET. Grows monotonically.
   */
  elidedToolCallIds: Set<string>
  /**
   * The ARG half of the ratchet: ids whose heavy mutate ARGUMENTS (write content /
   * patch body) were already sent elided. Separate from `elidedToolCallIds` because
   * the meanings differ — that one states the RESULT is gone; merging would
   * force-pointer results that were never elided.
   */
  elidedArgToolCallIds: Set<string>
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
   * Same 500-entry bound as the paired VBC store.
   */
  sessionFileMtimes: Map<string, FileMtimeStore>
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
