import { createCapabilitySourceRepository } from '../../capabilities/source-repository'
/**
 * Agent runner — composition root. Creates the runner-lifetime state and
 * repositories, wires the runtime infrastructure modules into the run/ application
 * layer, and assembles the AgentRunner API surface from them:
 *
 *   run                   → run/execute-run.ts (the turn lifecycle use-case, by stage)
 *   wake / queue / stop   → agent-runner-queue.ts over wake-queue.ts
 *   status / listings     → agent-runner-status.ts
 *   tool actions, grants → agent-runner-interaction.ts
 *   forget / shutdown     → agent-runner-lifecycle.ts
 *
 * It is the ONE runtime module allowed to import run/ (`runtime-layers.test.ts`), which is
 * why the run-layer pieces the infrastructure needs (the error classifier) are bound here and
 * handed down rather than imported there.
 */
import { registerContextToolClasses } from '@localixai/agent'

// Teach the SDK's VBC context machinery about Localix's own BUILTIN tools — the
// base classes in @localixai/agent are generic by design (no app names hardcoded).
// Extension tools are NOT listed here: they self-classify via
// `AgentTool.contextClass` and the plugin loader registers them generically, so
// core never knows an extension tool's name.
// `read` (images included) is already a base read-result tool. `view_image` was removed, but
// saved sessions still hold its results, which are recoverable observations like a read.
registerContextToolClasses({
  readResult: ['view_image', 'history_search'],
})

import type { RunnerDeps } from './agent-runner-types'
import { createRuntimeState, type LiveItemResolver } from './agent-runner-state'
import { sessionQuestions } from './question-view'
import { createRunnerPublishing } from './agent-runner-publishing'
import { createRunnerLifecycle } from './agent-runner-lifecycle'
import { createRunnerQueue } from './agent-runner-queue'
import { createRunnerStatus } from './agent-runner-status'
import { createRunnerInteraction } from './agent-runner-interaction'
import { drainMidRunReminders, recordMidRunReminder } from './mid-run-reminders'
import { createWakeQueue } from './wake-queue'
import { inviteAddressedAgents } from './run/conversation-invite'
import type { SessionRecord } from '../repository'
import { rosterLeadership } from './conversation-strategy'
import { createDatabaseWakeQueueStore } from './wake-queue-store'
import { resolveAuxiliaryModel as resolveAuxiliarySlotModel } from './model-resolution'
import { executeRun } from './run/execute-run'
import type { RunEnv, RunParams } from './run/types'
import { createUsageRepository } from '../../usage/repository'
import { createMemoryRepository } from '../../memory/repository'
import { createUserProfileRepository } from '../../user/repository'
import { createProjectsRepository } from '../../projects/repository'
import { createMcpRepository } from '../../mcp/repository'
import { failedRun } from './run-outcome'
import { classifyRunError } from './run/classify-run-error'
import { createAgentRunRepository } from '../../../db/agent-run-repository'

export function createAgentRunner(deps: RunnerDeps) {
  // Handed in, not built here: see `RunnerDeps.repo` for the turn that failed when it was.
  const repo = deps.repo
  const usageRepo = createUsageRepository(deps.db)
  const memoryRepo = createMemoryRepository(deps.db)
  const userProfileRepo = createUserProfileRepository(deps.db)
  const projectsRepo = createProjectsRepository(deps.db)
  const mcpRepo = createMcpRepository(deps.db)
  const pluginRepo = createCapabilitySourceRepository(deps.db, 'plugin')
  const agentRuns = createAgentRunRepository(deps.db)

  const state = createRuntimeState(deps.work)
  const { activeRuns, drainingSessions } = state
  const now = deps.now ?? (() => new Date().toISOString())

  const {
    publishChildSummary,
    markRuntimeSessionStatus,
    publishMessageSnapshot,
    persistAndPublish,
  } = createRunnerPublishing({
    repo,
    streamRegistry: deps.streamRegistry,
    now,
    liveItemResolvers: state.liveItemResolvers,
  })

  // Collaborators the stop/cancel policy needs (runtime/stop-session.ts).
  const stopCtx = {
    state,
    repo,
    streamRegistry: deps.streamRegistry,
    now,
    markRuntimeSessionStatus,
  }

  // Wake queue (push-a-session): callbacks avoid a module cycle.
  const leadership = (userId: string, projectId: string | null) =>
    rosterLeadership(deps.listRegistryAgents, userId, projectId)
  // A tag in the person's message brings an available agent in before the message is routed.
  const inviteAddressed = (userId: string, session: SessionRecord, text: string) =>
    inviteAddressedAgents(
      {
        repo,
        deps,
        activeAgentId: (sessionId: string) => state.activeRunSessions.get(sessionId)?.agentId,
      },
      userId,
      session,
      text,
    )
  const wakeQueue = createWakeQueue({
    repo,
    streamRegistry: deps.streamRegistry,
    now,
    state: { activeRuns, drainingSessions, sessionRunIdentity: state.sessionRunIdentity },
    store: createDatabaseWakeQueueStore(deps.db),
    leadership,
    inviteAddressed,
    run: (p) => runner.run(p),
  })

  const { trackRuntimeSession, ...lifecycle } = createRunnerLifecycle({ deps, state, wakeQueue })

  // The run/ application layer's view of the runner: repositories + state +
  // the runner-level operations a run may invoke (re-entrant run, wake, …).
  const runEnv: RunEnv = {
    deps,
    repo,
    usageRepo,
    memoryRepo,
    userProfileRepo,
    projectsRepo,
    mcpRepo,
    pluginRepo,
    agentRuns,
    state,
    now,
    resolveAuxiliaryModel: (userId, slot, catalog, inheritedReasoningEffort) =>
      resolveAuxiliarySlotModel({
        deps,
        userId,
        slot,
        catalog,
        inheritedReasoningEffort,
      }),
    publishChildSummary,
    markRuntimeSessionStatus,
    persistAndPublish,
    publishMessageSnapshot,
    executeToolAction: (toolCallId, actionName, payload) =>
      runner.executeToolAction(toolCallId, actionName, payload),
    run: (p) => runner.run(p),
    enqueueRun: wakeQueue.enqueueRun,
    cancelAgentTurns: wakeQueue.cancelAgentTurns,
    boostReferencedAgentTurns: wakeQueue.boostReferencedAgentTurns,
    queueMidRunReminder: (address, body) => recordMidRunReminder(state, address, body),
    drainMidRunReminders: (address) => drainMidRunReminders(state, address),
    drainPendingAndRun: wakeQueue.drainPendingAndRun,
    hasPendingQueue: (sessionId) => Promise.resolve(wakeQueue.hasPending(sessionId)),
    reserveSteerableTurns: (sessionId, accepts, subagent) =>
      Promise.resolve(wakeQueue.reserveSteerable(sessionId, accepts, subagent)),
    peekSteerableTurn: (sessionId, accepts, subagent) =>
      wakeQueue.peekSteerable(sessionId, accepts, subagent),
    ackSteerableTurn: (userId, sessionId, itemId) =>
      Promise.resolve(wakeQueue.ackSteerable(userId, sessionId, itemId)),
    releaseSteerableTurn: (sessionId, itemId) =>
      Promise.resolve(wakeQueue.releaseSteerable(sessionId, itemId)),
  }

  const runner = {
    leadership,
    inviteAddressed,
    /**
     * Patch a tool item a LIVE run still writes (`run/live-item.ts`). False when no run holds it,
     * and the caller writes the stored row — which no run will write again.
     */
    patchLiveToolItem: (toolCallId: string, patch: Parameters<LiveItemResolver>[0]): boolean =>
      state.liveItemResolvers.get(toolCallId)?.(patch) ?? false,
    /** A session's open queued questions, as the composer lists them. */
    listQuestions: (userId: string, sessionId: string) =>
      sessionQuestions(deps.questions, userId, sessionId),
    ...createRunnerStatus(state),
    ...createRunnerQueue({ state, wakeQueue, stopCtx }),
    ...createRunnerInteraction({ deps, repo, state }),
    ...lifecycle,

    async run(params: RunParams) {
      trackRuntimeSession(params.session.id)
      try {
        const outcome = await executeRun(runEnv, params)
        // A physical segment must release its drain/run lease as soon as it
        // hands ownership to a continuation. The queue owns logical waiting;
        // awaiting the shared completion here deadlocks a queued continuation
        // behind the still-held drain lease.
        if (outcome.status !== 'continued') params.chain.completion?.settle(outcome)
        return outcome
      } catch (error) {
        const outcome = failedRun(classifyRunError(deps, params.userId, error))
        if (params.chain.completion) {
          params.chain.completion.settle(outcome)
          return outcome
        }
        throw error
      }
    },
  }

  return runner
}

export type AgentRunner = ReturnType<typeof createAgentRunner>
