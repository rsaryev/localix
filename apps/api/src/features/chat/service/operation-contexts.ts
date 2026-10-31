import { createWakeDelivery } from '../../triggers/delivery'
import { resolveDefaultProject } from '../../projects/default-project'
import type { WakeRequest } from '../contracts'
import { publishAgentPhase } from '../runtime/session-stream-registry'
import { publishSessionUsageSnapshot } from '../runtime/session-usage'
import { recordAuxCallUsage } from '../runtime/usage-normalize'
import { createRecapService } from '../recap/service'
import { createAuxProviderHelpers } from './aux-provider'
import type { BranchingOpsContext } from './branching-ops'
import type { CommandHandlerContext } from './command-handlers'
import type { ChatServiceDeps } from './context'
import type { ExternalSessionsContext } from './external-sessions'
import type { FileOpsContext } from './file-ops'
import { createSpawnForkSkill } from './fork-skill'
import { createRunAgent } from './run-agent'
import { createRunMacroCommand } from './run-macro'
import { createAnswerPendingAsk } from './composer-ask-answer'
import type { ChatServiceGraph } from './service-graph'
import type { SessionCore } from './session-core'
import type { SkillOpsContext } from './skill-ops'
import { createSyntheticMessages } from './synthetic-messages'
import type { ThreadOpsContext } from './thread-ops'
import { createTitleGenerator } from './title-generation'
import * as turnEntry from './turn-entry'

/**
 * The context each group of chat operations is handed — command handlers, branching, file ops,
 * skills, external sessions, threads, turn entry — and the helpers they share.
 *
 * Built in ONE place because they share collaborators that must be the same instance across
 * groups: one `runAgent` (the title generator hangs off it, so a second copy would title a
 * session twice or never), one `sessionLifecycleCtx`, one wake delivery. A context assembled
 * beside the operation that uses it would quietly grow its own. Order follows dependency: the
 * aux model helpers before the title generator, `runAgent` before every context that starts a
 * run, and the turn-entry context before the delivery that wakes through it.
 */
export function createOperationContexts(
  deps: ChatServiceDeps,
  graph: ChatServiceGraph,
  core: SessionCore,
) {
  const {
    now,
    repo,
    routeDefaults,
    usageRepo,
    projectsRepo,
    mcpRepo,
    availabilityWriter,
    pluginService,
    miniAppService,
    streamRegistry,
    runner,
    withSessionMutationLock,
  } = graph
  const {
    requireSession,
    resolveProjectWorkingDir,
    resolveSessionWorkingDir,
    gatherSessionSkills,
    gatherEnabledPluginCommands,
    gatherEnabledPluginSkills,
    buildSessionPluginCatalog,
    loadSessionPluginMcpServers,
    getSessionDetail,
    publishSession,
    sessionLifecycleCtx,
  } = core

  const { buildLanguageModel, readAgentSettings } = createAuxProviderHelpers({
    ...deps,
    userProfileRepo: deps.ports.userProfileRepo,
  })

  const maybeGenerateTitle = createTitleGenerator({
    repo,
    readAgentSettings,
    buildLanguageModel,
    publishSession,
    publishPhase: (...args) => publishAgentPhase(streamRegistry, ...args),
    // Record every billed titling call. The normal path runs once, while retries
    // or concurrent first turns accumulate under the same routing identity.
    recordUsage: ({ userId, sessionId, modelId, providerConnectionId, providerId, usage }) =>
      recordAuxCallUsage({
        usageRepo,
        kind: 'title',
        userId,
        sessionId,
        modelId,
        providerConnectionId,
        providerId,
        usage,
        onRecorded: () =>
          publishSessionUsageSnapshot({
            repo,
            usageRepo,
            streamRegistry,
            userId,
            sessionId,
          }),
      }),
  })

  /**
   * Synthetic message insertion (direct replies + context boundaries) lives in
   * synthetic-messages.ts — it persists messages and emits the stream events
   * without running the agent loop.
   */
  const { insertDirectReply, insertSystemNotice } = createSyntheticMessages({
    repo,
    streamRegistry,
    publishSession,
  })

  /**
   * Runs the agent from a slash-command macro: the user sees the short command
   * (e.g. "/sample-command") while the agent receives a richer hidden instruction.
   */
  const runMacroCommand = createRunMacroCommand({
    repo,
    streamRegistry,
    publishSession,
    runner,
  })

  /** Insert user message, create empty assistant slot, fire runner, return immediately. */
  const runAgent = createRunAgent({
    repo,
    streamRegistry,
    runner,
    maybeGenerateTitle,
    publishSession,
  })

  // Absent means no policy at all — the same answer an untouched installation gives, and
  // what a lightweight test host wants without stating it. One binding for both the command
  // handlers and the skill facade, so the two cannot disagree about that default.
  const loadSkillOverrides = async (
    ...args: Parameters<NonNullable<ChatServiceDeps['loadSkillOverrides']>>
  ) => (await deps.loadSkillOverrides?.(...args)) ?? {}

  // Written as a record only: `insertSystemNotice` binds no model context for a recap.
  const recapService = createRecapService({
    repo,
    readAgentSettings,
    buildLanguageModel,
    insertNotice: (userId, sessionId, notice, settleOptimistic) =>
      insertSystemNotice(userId, sessionId, notice, now(), settleOptimistic),
    nowMs: () => Date.parse(now()),
    recordUsage: ({ userId, sessionId, modelId, providerConnectionId, providerId, usage }) =>
      recordAuxCallUsage({
        usageRepo,
        kind: 'recap',
        userId,
        sessionId,
        modelId,
        providerConnectionId,
        providerId,
        usage,
        onRecorded: () =>
          publishSessionUsageSnapshot({ repo, usageRepo, streamRegistry, userId, sessionId }),
      }),
  })

  const commandCtx: CommandHandlerContext = {
    ...(deps.loadSkillCommandRules ? { loadSkillCommandRules: deps.loadSkillCommandRules } : {}),
    ...(deps.skillShellDisabled ? { skillShellDisabled: deps.skillShellDisabled } : {}),
    deps,
    repo,
    usageRepo,
    mcpRepo,
    availabilityWriter,
    pluginService,
    miniAppService,
    runner,
    now,
    publishSession,
    insertDirectReply,
    insertSystemNotice,
    recap: recapService.recap,
    runMacroCommand,
    runAgent,
    gatherSessionSkills,
    loadSkillOverrides,
    gatherEnabledPluginCommands,
    gatherEnabledPluginSkills,
    resolveSessionWorkingDir,
    buildSessionPluginCatalog,
    loadSessionPluginMcpServers,
    // CC `context: fork` — run the skill in a child session, as the invoking agent.
    spawnForkSkill: createSpawnForkSkill({
      repo,
      now,
      requireSession,
      runAgent,
      sessionLifecycleCtx,
      // The model and effort the person chose for the agent; the skill's own are not read.
      chosenRoute: async (userId, agentId) =>
        (await deps.loadAgentModelDefaults?.(userId, null))?.get(agentId) ?? {},
    }),
  }

  const branchingCtx: BranchingOpsContext = {
    repo,
    runner,
    streamRegistry,
    now,
    requireSession,
    getSessionDetail,
    withSessionMutationLock,
    notifications: deps.notifications,
  }

  const fileOpsCtx: FileOpsContext = {
    requireSession,
    resolveSessionWorkingDir,
  }

  const skillOpsCtx: SkillOpsContext = { now, resolveProjectWorkingDir, logger: deps.logger }

  const externalSessionsCtx: ExternalSessionsContext = {
    repo,
    streamRegistry,
    now,
    requireSession,
    runAgent,
    withSessionMutationLock,
    resolveDefaultProjectId: async (owner) =>
      (await resolveDefaultProject(projectsRepo, owner, now)).id,
    resolveSessionAgent: deps.resolveSessionAgent,
    startingRoute: routeDefaults.startingRoute,
  }

  const threadOpsCtx: ThreadOpsContext = {
    repo,
    now,
    requireSession,
    getSessionDetail,
    sessionLifecycleCtx,
  }

  // Every way a turn STARTS on an existing session (user send, engine job, wake,
  // sleep-resume, mode continuation) — see turn-entry.ts.
  const turnEntryCtx: turnEntry.TurnEntryContext = {
    deps,
    repo,
    runner,
    streamRegistry,
    now,
    requireSession,
    publishSession,
    runAgent,
    commandCtx,
    withSessionMutationLock,
    answerPendingAsk: createAnswerPendingAsk(graph),
  }

  // The wakes chat raises itself (a reaction) go through the same one delivery as every other
  // producer's (`features/triggers/delivery.ts`), over chat's own wake primitive.
  const wakes = createWakeDelivery<WakeRequest>({
    wake: (request) => turnEntry.wakeSession(turnEntryCtx, request),
    logger: { warn: (entry) => console.warn('[chat] wake not delivered', entry) },
  })

  return {
    buildLanguageModel,
    readAgentSettings,
    loadSkillOverrides,
    recapService,
    commandCtx,
    branchingCtx,
    fileOpsCtx,
    skillOpsCtx,
    externalSessionsCtx,
    threadOpsCtx,
    turnEntryCtx,
    wakes,
  }
}

export type OperationContexts = ReturnType<typeof createOperationContexts>
