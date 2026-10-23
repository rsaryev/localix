/**
 * The state one admitted run shares across its stages.
 *
 * A run is a chain of stages (admit → policy → turn → context → tools → prompt → intake → history →
 * stream → complete | fail), but three readers sit OUTSIDE that chain and see whatever the
 * chain got to before it stopped: the failure path, the checkpoint/transient reruns it
 * starts, and teardown. Each of them needs the CURRENT value of something a stage changed —
 * the session after its provider was rebound, the assistant row after a steer split, the run
 * row once it opened, the hooks once they loaded. Passing those as stage return values loses
 * them the moment a stage throws, so they live here, on one object every stage writes and the
 * three late readers read. Everything else a stage produces is its return value.
 */
import type { FixedContextDescription } from '@localixai/agent/agents'

import type { SessionAgentRoute } from '../../../contracts/read-model'
import type { SessionRecord } from '../../../repository'
import type { CcHooksRuntime } from '../../../../cc-hooks'
import type { LoadedMiniAppHook } from '../../../../mini-apps/loader-contract'
import type { ContextBudgetFrame } from '../../context-budget'
import type { TurnEventContext } from '../event-handlers'
import type { AgentRunRecord } from '../run-record'
import type { RunSessionSnapshotRow } from '../session-snapshot'
import type { SessionStores } from '../session-stores'
import type { RunEnv, RunParams } from '../types'

export interface RunFrame {
  readonly env: RunEnv
  readonly params: RunParams
  readonly userId: string
  readonly speakerAgentId: string
  /** The row the run opened on; `currentAssistantMessageId` is the one it ends on. */
  readonly assistantMessageId: string
  /** Throws once a stop or delete revoked this run's admission ticket. */
  readonly assertAdmitted: () => void
  readonly abort: AbortController
  /** Continuations skip the pre-token phases their initiating turn already showed. */
  readonly isContinuation: boolean
  /** Model resolution may rebind the provider; every later reader must see the rebound row. */
  session: SessionRecord
  speakerRoute: SessionAgentRoute
  /** The row the runtime-status writes go through, kept in step with `activeRunSessions`. */
  runtimeSession: SessionRecord
  readonly publishRuntimeSession: (status: SessionRecord['runtimeStatus']) => Promise<void>
  /** Transient pre-token phase for the reply skeleton. */
  readonly publishPhase: (phase: string) => void
  /** The owner's sessions, read once and shared by HITL routing and the descendant roster. */
  readonly loadSessionSnapshot: () => Promise<RunSessionSnapshotRow[]>
  /** Where a prompt from this run would go, and whether anyone is there (hitl-reachable.ts). */
  readonly hitl: { readonly targetSessionId: string | null; readonly reachable: boolean }
  readonly stores: SessionStores
  /** Late-bound event context: follows the current assistant row across steer splits. */
  readonly steerCtxRef: { current: TurnEventContext | null }
  /** The context budget, read lazily by `context_budget` and by the failure diagnostics. */
  readonly budget: { frame?: ContextBudgetFrame; fixed?: FixedContextDescription }
  /** Whether the failure happened at the provider or before it (preflight). */
  providerAttemptStarted: boolean
  /** The durable run row, once opened — the failure path closes it. */
  runRecord?: AgentRunRecord
  /** What teardown releases; filled as each resource is acquired. */
  readonly teardown: {
    unsubLsp?: () => void
    defaultCwd?: string
    miniAppHooks: readonly LoadedMiniAppHook[]
    ccHooks?: CcHooksRuntime
    readonly liveResolverKeys: Set<string>
  }
}

/** After a mid-run steer split the CURRENT row is the one to finalize or retry on. */
export const currentAssistantMessageId = (frame: RunFrame): string =>
  frame.steerCtxRef.current?.assistantMessageId ?? frame.assistantMessageId
