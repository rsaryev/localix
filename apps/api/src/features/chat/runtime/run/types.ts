/**
 * The environment one agent run executes in: the composition root's wiring, handed to the
 * use-case. The run's PARAMETERS live one layer down in `../run-contract.ts` (both layers
 * name them) and are re-exported here for the run/ modules that consume both.
 *
 * Layer rule, enforced by `../runtime-layers.test.ts`: run/ modules may import runtime
 * infrastructure (`../*`) and agent-core, but never features/chat/service*. Infrastructure
 * modules must never import anything from run/.
 */
import type { RunnerDeps } from '../agent-runner-types'
import type { RuntimeState } from '../agent-runner-state'
import type { ReasoningEffort } from '@localixai/agent'
import type { ChatRepository, SessionRecord } from '../../repository'
import type { WakeSource } from '../../contracts'
import type { StoredMessagePayload } from '../../../../db'
import type { createUsageRepository } from '../../../usage/repository'
import type { createMemoryRepository } from '../../../memory/repository'
import type { createUserProfileRepository } from '../../../user/repository'
import type { createProjectsRepository } from '../../../projects/repository'
import type { createMcpRepository } from '../../../mcp/repository'
import type { resolveAuxiliaryModel } from '../model-resolution'
import type { AgentRunRepository } from '../../../../db/agent-run-repository'
import type { RunExecutionOutcome } from '../run-outcome'
import type { RunParams } from '../run-contract'
import type { CapabilitySourceRepository } from '../../../capabilities/source-repository'
import type { EnqueueRun } from '../agent-turn-ticket'
import type { AgentTurnFilter } from '../wake-queue/agent-turns'
import type { ExecutionAddress } from '../../../agent-core/execution-address'
import type { SubagentSteeringAddress } from '../wake-queue/steering'

export type { RunChain, RunParams, RunScope, RunTurn } from '../run-contract'

/** The catalog shape returned by the catalog service (kept as a derived type). */
export type RunCatalog = Awaited<ReturnType<RunnerDeps['catalogService']['getCatalog']>>

/**
 * Everything a run needs from the composition root (agent-runner.ts):
 * repositories, runner-lifetime state, and the small set of runner-level
 * operations (re-entrant run, wake, persistence helpers).
 */
export interface RunEnv {
  deps: RunnerDeps
  repo: ChatRepository
  usageRepo: ReturnType<typeof createUsageRepository>
  memoryRepo: ReturnType<typeof createMemoryRepository>
  userProfileRepo: ReturnType<typeof createUserProfileRepository>
  projectsRepo: ReturnType<typeof createProjectsRepository>
  mcpRepo: ReturnType<typeof createMcpRepository>
  pluginRepo: CapabilitySourceRepository
  /** Durable run rows: one per adapter invocation, swept on the next boot if it never closed. */
  agentRuns: AgentRunRepository
  state: RuntimeState
  now: () => string
  resolveAuxiliaryModel: (
    userId: string,
    slot:
      | {
          providerConnectionId?: string
          modelId?: string
          reasoningEffort?: ReasoningEffort
        }
      | null
      | undefined,
    catalog: RunCatalog,
    inheritedReasoningEffort?: ReasoningEffort,
  ) => ReturnType<typeof resolveAuxiliaryModel>
  publishChildSummary: (parentSessionId: string, child: SessionRecord) => void
  markRuntimeSessionStatus: (
    userId: string,
    session: SessionRecord,
    status: SessionRecord['runtimeStatus'],
  ) => Promise<SessionRecord>
  persistAndPublish: (
    userId: string,
    sessionId: string,
    messageId: string,
    payload: StoredMessagePayload,
    createdAt: string,
  ) => Promise<void>
  publishMessageSnapshot: (
    userId: string,
    sessionId: string,
    messageId: string,
    payload: StoredMessagePayload,
    createdAt: string,
    updatedAt: string,
  ) => void
  executeToolAction: (toolCallId: string, actionName: string, payload?: unknown) => boolean
  /** Re-entrant run — continuations and wakes go through here. */
  run: (params: RunParams) => Promise<RunExecutionOutcome>
  enqueueRun: EnqueueRun
  cancelAgentTurns(userId: string, sessionId: string, filter?: AgentTurnFilter): Promise<void>
  boostReferencedAgentTurns(
    userId: string,
    session: Pick<SessionRecord, 'id' | 'agents'>,
    speakerAgentId: string,
    text: string,
  ): Promise<void>
  /**
   * Queue a fact that became true WHILE the agent is working, to surface at the
   * loop's next tool-result seam (see mid-run-reminders.ts). Unlike `wake` this
   * does not start a run — it reaches the turn already in flight, which is the
   * only channel that can.
   */
  queueMidRunReminder: (address: ExecutionAddress, body: string) => void
  /** Drain one participant's queued mid-run reminders into one tagged body, or null. */
  drainMidRunReminders: (address: ExecutionAddress) => string | null
  drainPendingAndRun: (sessionId: string) => Promise<void>
  /** True if the session has queued turns waiting (drives the run's finally drain). */
  hasPendingQueue: (sessionId: string) => Promise<boolean>
  /**
   * MID-RUN STEERING: lease content-only USER turns, and an eligible child report
   * after a completed tool turn. Each lease
   * is acknowledged only after its transcript row commits; failures release it.
   */
  reserveSteerableTurns: (
    sessionId: string,
    /** Only a message this returns true for may be taken (see `addressedToSpeaker`). */
    accepts?: (content: string) => boolean,
    subagent?: SubagentSteeringAddress,
  ) => Promise<
    Array<{
      id: string
      userId: string
      content: string
      queuedAt: string
      source?: WakeSource
      internal?: boolean
      clientMessageId?: string
    }>
  >
  ackSteerableTurn: (userId: string, sessionId: string, itemId: string) => Promise<boolean>
  releaseSteerableTurn: (sessionId: string, itemId: string) => Promise<void>
}
