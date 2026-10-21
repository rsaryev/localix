import { announceInterruptedRuns } from '../features/chat/runtime/interrupted-runs'
import { createTurnStartRepository } from '../features/chat/runtime/turn-start-repository'
import { settleUnstartedTurns } from '../features/chat/runtime/unstarted-turns'
import { createChatRepository } from '../features/chat/repository'
import type { WakeRequest } from '../features/chat/contracts'
import type { createChatService } from '../features/chat/service'
import type { WakeDelivery } from '../features/triggers/delivery'
import { setAgentService } from '../features/chat/runtime/agent-service-binding'
import type { createAgentsService } from '../features/agents/service'
import type { createDatabase } from '../db'
import { markInterruptedRunAnnounced } from '../db/migrator'
import type { createLogger } from '../lib/logger'
import type { loadEnv } from '../lib/env'
import type { InfraPhase } from './infra'
import { createCapabilityRuleRepository } from '../features/capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { seedStarterTeam } from '../features/agents/seed-starter-team'
import { seedAgentPresets } from '../features/capabilities/seed-agent-presets'
import { listDelegatedRuns } from '../features/chat/service/delegated-runs'

export interface AgentFacadePhaseInput {
  db: ReturnType<typeof createDatabase>
  env: ReturnType<typeof loadEnv>
  logger: ReturnType<typeof createLogger>
  chatService: ReturnType<typeof createChatService>
  /** The one wake delivery — a finished child's report reaches its parent through it. */
  wakes: WakeDelivery<WakeRequest>
  agentsService: ReturnType<typeof createAgentsService>
  finalAssistantText: InfraPhase['digests']['finalAssistantText']
  bootRepo: InfraPhase['bootRepo']
  interruptedRuns: InfraPhase['interruptedRuns']
}

export async function createAgentFacadePhase({
  db,
  env,
  logger,
  chatService,
  wakes,
  agentsService,
  finalAssistantText,
  bootRepo,
  interruptedRuns,
}: AgentFacadePhaseInput): Promise<void> {
  // The scoped verdict store this phase resolves against. Built here rather than passed in:
  // the facade is the only consumer, and a repository over the same `db` is not shared state.
  const capabilityRules = createCapabilityRuleRepository(db)

  // Each role's shipped defaults, applied to its own scope once. Here because this is the
  // module that already knows how a handle maps to a capability scope, and because the seed
  // has to happen before a run resolves one.
  //
  // Awaited but never fatal: a boot that cannot write a default must still boot, and the
  // agent simply inherits as it did before. Global scope only for now — a project-scoped
  // record's rules are keyed by handle like everyone else's, but nothing lists those here.
  const presetPorts = {
    // Spread, not `(userId) =>`: a composition root may not spell a parameter list it is
    // only forwarding, or growing the owner a parameter drops it silently here.
    listAgents: async (...args: Parameters<typeof agentsService.listAgents>) =>
      (await agentsService.listAgents(...args)).map((summary) => summary.record),
    rules: capabilityRules,
    sources: createCapabilitySourceRepository(db, 'agent'),
  }
  try {
    const seeded = await seedAgentPresets(presetPorts, env.LOCALIX_DEFAULT_USER_ID)
    if (seeded.length > 0) logger.info(`[agents] applied role defaults: ${seeded.join(', ')}`)
  } catch (error) {
    logger.warn(`[agents] role defaults could not be applied: ${String(error)}`)
  }
  // The starter team, written once into the person's own registry as ordinary agents they can
  // edit or delete; only `localix` stays built in. Never fatal, like the defaults above.
  try {
    const created = await seedStarterTeam(
      {
        createAgent: (...args) => agentsService.createAgent(...args),
        sources: presetPorts.sources,
      },
      env.LOCALIX_DEFAULT_USER_ID,
    )
    if (created.length > 0) logger.info(`[agents] added the starter team: ${created.join(', ')}`)
  } catch (error) {
    logger.warn(`[agents] the starter team could not be added: ${String(error)}`)
  }
  // One admission for every delegation lookup: the `delegation` invocation host's verdict, and
  // the run defaults a child inherits — never its instructions or model preferences, which the
  // child session resolves from its own seat.
  const admitDelegate = async (agentId: string, projectId: string | undefined) => {
    const record = await agentsService.resolveInvocableAgent(
      env.LOCALIX_DEFAULT_USER_ID,
      agentId,
      'delegation',
      projectId ?? null,
    )
    if (!record) return null
    const {
      prompt: _instructions,
      preferredProvider: _provider,
      preferredModel: _model,
      preferredEffort: _effort,
      ...defaults
    } = agentRunDefaults(record)
    return { record, defaults }
  }
  setAgentService({
    createSession: (...args) => chatService.createSession(...args),
    runJobTask: (...args) => chatService.runJobTask(...args),
    // Detached completion watcher reads the child's final reply before waking the root chat.
    finalAssistantText,
    // Agent-driven lifecycle management keeps the normal ownership gate.
    stopSession: async (...args) => {
      await chatService.stop(...args)
    },
    messageSubagent: (...args) => chatService.messageSubagent(...args),
    // Background (non-blocking) delegation: a finished child pushes its result back
    // into the parent chat session as a wake (queued if the parent is mid-run). Its callers
    // are completion watchers with nothing to do about a miss, so the one delivery names it.
    wakeSession: async (request) => wakes.send(request, 'delegation report'),
    // Read a finished child's runtime status so delegate reports a failed/stopped
    // child as such instead of mislabeling it 'completed' (getSessionRuntime is
    // id-only — no userId needed).
    childRuntimeStatus: async (...args) =>
      (await createChatRepository(db).getSessionRuntime(...args))?.runtimeStatus ?? null,
    // The delegation budget, read per delegation ATTEMPT and never cached: the point is to
    // observe the children created since the person last wrote. Concurrency is the lanes' job.
    countDelegationsSinceHuman: (...args) =>
      createChatRepository(db).countDelegationsSinceHuman(...args),
    closeSubagent: (...args) => chatService.closeSubagent(...args),
    flushChildMessages: (...args) => chatService.flushChildMessages(...args),
    listDelegatedRuns: (...args) => listDelegatedRuns(db, ...args),
    resolveRunAgent: (...args) => agentsService.resolveRunAgent(...args),
    // How `delegate` resolves the agent a task goes to (by id; a handle is accepted too), admitted
    // through its `delegation` host with the defaults its child run takes.
    resolveDelegateAgent: async (reference, { projectId }) => {
      const wanted = reference.trim().replace(/^@/, '').trim()
      const byHandle = async () =>
        (await agentsService
          .selectEnabledAgent(env.LOCALIX_DEFAULT_USER_ID, wanted, projectId ?? null)
          .catch(() => null)) ?? null
      const admitted =
        (await admitDelegate(wanted, projectId)) ??
        (await byHandle().then((record) => (record ? admitDelegate(record.id, projectId) : null)))
      return admitted
        ? { ...admitted.defaults, agentId: admitted.record.id, handle: admitted.record.handle }
        : null
    },
  })
  // Reload persisted user-stop intents BEFORE the first tick. `runtime_status='stopped'`
  // cannot tell a user Stop from an infra interrupt, so the engine's reconcile needs the
  // separate flag — and a restart in between (the exact case the boot sweep above exists
  // for) would otherwise read it as absent and resurrect a task the user cancelled.
  // Say, in the transcript, that a run was cut off by the restart — the sweep above only made the
  // ROWS consistent, and a truncated assistant answer with no notice reads as a complete one.
  if (interruptedRuns.length > 0) {
    const announced = await announceInterruptedRuns(
      {
        repo: bootRepo,
        streamRegistry: chatService.streamRegistry,
        now: () => new Date().toISOString(),
        markAnnounced: (runId) => markInterruptedRunAnnounced(db, runId),
        logger: { warn: (msg) => logger.warn({ event: 'boot.interrupted_notice_failed', msg }) },
      },
      interruptedRuns,
    )
    logger.info?.(
      `[boot] ${interruptedRuns.length} run(s) were interrupted before their transcript notice; announced ${announced}`,
    )
  }
  // An agent turn acknowledged before its run record existed: say so instead of leaving an empty
  // reply placeholder forever (`unstarted-turns.ts`).
  const unstarted = await settleUnstartedTurns({
    turnStarts: createTurnStartRepository(db),
    repo: bootRepo,
    streamRegistry: chatService.streamRegistry,
    now: () => new Date().toISOString(),
    logger: { warn: (msg) => logger.warn({ event: 'boot.unstarted_turn_failed', msg }) },
  })
  if (unstarted > 0) logger.info?.(`[boot] ${unstarted} agent turn(s) never started; announced`)
}
import { agentRunDefaults } from '../features/agents/run-defaults'
