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
  readResult: ['view_image', 'GlobalSearch'],
})

import type { RunnerDeps } from './agent-runner-types'
import { createRuntimeState } from './agent-runner-state'
import { createRunnerPublishing } from './agent-runner-publishing'
import { createRunnerLifecycle } from './agent-runner-lifecycle'
import { createRunnerQueue } from './agent-runner-queue'
import { createRunnerStatus } from './agent-runner-status'
import { createRunnerInteraction } from './agent-runner-interaction'
import { drainMidRunReminders, recordMidRunReminder } from './mid-run-reminders'
import { createWakeQueue } from './wake-queue'
import { createDatabaseWakeQueueStore } from './wake-queue-repository'
import { resolveAuxiliaryModel as resolveAuxiliarySlotModel } from './model-resolution'
import { executeRun } from './run/execute-run'
import { requestCheckpoint } from './run/session-stores'
import type { RunEnv, RunParams } from './run/types'
import { failedRun } from './run-outcome'
import { classifyRunError } from './run/classify-run-error'
import { createAgentRunRepository } from '../../../db/agent-run-repository'
import { recordSessionChanges } from '../session-changes'
import { awaitsReports, onReportSettled } from '../../agent-core/delegation-awaits'

export function createAgentRunner(deps: RunnerDeps) {
  // Handed in, not built here: see `RunnerDeps.repo` for the turn that failed when it was.
  const repo = deps.repo
  // Other features' stores, built by the composition root (`bootstrap/chat-feature-ports.ts`).
  const { usageRepo, userProfileRepo, projectsRepo, mcpRepo, pluginRepo, miniAppRepo } = deps.ports
  const runs = createAgentRunRepository(deps.db)
  const agentRuns: typeof runs = {
    ...runs,
    // A run leaving `running` finalizes its chat's last message (the search projection's
    // trigger): say the chat changed, so consumers re-read it.
    async finishRun(userId, input) {
      await runs.finishRun(userId, input)
      await recordSessionChanges(deps.db, userId, [input.sessionId])
    },
  }

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
  const wakeQueue = createWakeQueue({
    repo,
    streamRegistry: deps.streamRegistry,
    now,
    state: { activeRuns, drainingSessions, sessionRunIdentity: state.sessionRunIdentity },
    store: createDatabaseWakeQueueStore(deps.db),
    // Whether a delegator still waits on children at work, and word when that changes: the
    // delegation ledger's facts, which the queue only asks (`wake-queue/holds.ts`).
    reportBarrier: { awaits: awaitsReports, subscribe: onReportSettled },
    run: (p) => runner.run(p),
  })

  const { trackRuntimeSession, ...lifecycle } = createRunnerLifecycle({ deps, state, wakeQueue })

  // The run/ application layer's view of the runner: repositories + state +
  // the runner-level operations a run may invoke (re-entrant run, wake, …).
  const runEnv: RunEnv = {
    deps,
    repo,
    usageRepo,
    userProfileRepo,
    projectsRepo,
    mcpRepo,
    pluginRepo,
    miniAppRepo,
    agentRuns,
    state,
    now,
    resolveAuxiliaryModel: (userId, slot, catalog) =>
      resolveAuxiliarySlotModel({ deps, userId, slot, catalog }),
    publishChildSummary,
    markRuntimeSessionStatus,
    persistAndPublish,
    publishMessageSnapshot,
    executeToolAction: (toolCallId, actionName, payload) =>
      runner.executeToolAction(toolCallId, actionName, payload),
    run: (p) => runner.run(p),
    enqueueRun: wakeQueue.enqueueRun,
    cancelAgentTurns: wakeQueue.cancelAgentTurns,
    queueMidRunReminder: (sessionId, body) => recordMidRunReminder(state, sessionId, body),
    drainMidRunReminders: (sessionId) => drainMidRunReminders(state, sessionId),
    drainPendingAndRun: wakeQueue.drainPendingAndRun,
    hasPendingQueue: (sessionId) => Promise.resolve(wakeQueue.hasPending(sessionId)),
    reserveSteerableTurns: (sessionId, filter) =>
      Promise.resolve(wakeQueue.reserveSteerable(sessionId, filter)),
    peekSteerableTurn: (sessionId, filter) => wakeQueue.peekSteerable(sessionId, filter),
    ackSteerableTurn: (userId, sessionId, itemId) =>
      Promise.resolve(wakeQueue.ackSteerable(userId, sessionId, itemId)),
    releaseSteerableTurn: (sessionId, itemId) =>
      Promise.resolve(wakeQueue.releaseSteerable(sessionId, itemId)),
  }

  const runner = {
    /** Claude Code hooks between runs (model switch, project move, watched files). */
    ccHookSessions: state.ccHookSessions,
    ...createRunnerStatus(state),
    ...createRunnerQueue({ state, wakeQueue, stopCtx }),
    ...createRunnerInteraction({ deps, repo, state }),
    ...lifecycle,
    /** `/compact`: the named agents' next turn takes a checkpoint (`run/session-stores.ts`). */
    requestCheckpoint: (sessionId: string, instructions: string) =>
      requestCheckpoint(state, sessionId, instructions),

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
