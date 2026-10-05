import type { ChatServiceDeps } from './service/context'
export type { SkillInput, SkillRecord } from './service/skills'
import { createChatServiceGraph } from './service/service-graph'
import { createSessionCore } from './service/session-core'
import { createOperationContexts } from './service/operation-contexts'
import { createChatRuntimeFacade } from './service/runtime-facade'
import { createChatSessionFacade } from './service/session-facade'
import { createChatMessageFacade } from './service/message-facade'
import { createChatInteractionFacade } from './service/interaction-facade'
import { createChatQuestionFacade } from './service/question-facade'
import { createChatFileFacade } from './service/file-facade'
import { createChatUsageFacade } from './service/usage-facade'
import { createChatQueryFacade } from './service/query-facade'
import { createChatInboundFacade } from './service/inbound-facade'
import { createChatSkillFacade } from './service/skill-facade'

/**
 * The chat service: one API surface assembled from facades over one object graph.
 *
 * A single ~900-line closure used to hold the graph, the session closures, every operation
 * context and ninety methods at once, so which method could reach which collaborator had to be
 * read out of the whole file. The layers are now built in the order they depend on each other —
 * graph (deps alone) → session core (needs a session) → operation contexts (share one
 * `runAgent` and one wake delivery) → facades — and each facade is handed only the part it
 * uses. The returned shape is the union of the facades; nothing is added here.
 */
export function createChatService(deps: ChatServiceDeps) {
  const graph = createChatServiceGraph(deps)
  const { now, repo, usageRepo, streamRegistry, runner } = graph
  const core = createSessionCore(deps, graph)
  const {
    requireSession,
    getSessionDetail,
    publishSession,
    sessionLifecycleCtx,
    sessionDetailCtx,
    fileWatchService,
    resolveSessionWorkspaceMetadata,
    gatherSessionSkills,
  } = core
  const contexts = createOperationContexts(deps, graph, core)
  // Built ahead of the facades that need it: a branch move reconciles the session's questions.
  const questionFacade = createChatQuestionFacade({
    ...graph,
    db: deps.db,
    questions: deps.questions,
    requireSession,
    wakes: contexts.wakes,
  })

  return {
    streamRegistry,

    ...createChatRuntimeFacade({ ...graph, requireSession }),

    ...createChatQueryFacade({ repo, runner, sessionLifecycleCtx }),

    ...createChatSkillFacade({
      skillOpsCtx: contexts.skillOpsCtx,
      requireSession,
      getSessionDetail,
      publishSession,
      gatherSessionSkills,
      readAgentSettings: contexts.readAgentSettings,
      loadSkillOverrides: contexts.loadSkillOverrides,
      repo,
      now,
    }),

    ...createChatSessionFacade({
      repo,
      now,
      sessionLifecycleCtx,
      sessionDetailCtx,
      getSessionDetail,
    }),

    /**
     * Ownership-checked session root metadata for platform services. Cwd-only
     * consumers must not call `listDirectory`: that needlessly enumerates the
     * Explorer root and, for SSH/Docker sessions, adds a remote shell round-trip.
     */
    ...createChatFileFacade({
      fileOpsCtx: contexts.fileOpsCtx,
      fileWatchService,
      resolveSessionWorkspaceMetadata,
    }),

    ...createChatMessageFacade({
      ...graph,
      requireSession,
      turnEntryCtx: contexts.turnEntryCtx,
      branchingCtx: contexts.branchingCtx,
      wakes: contexts.wakes,
      onBranchMoved: questionFacade.reconcileQuestions,
    }),

    ...createChatInteractionFacade({ ...graph, deps }),

    ...questionFacade,

    ...createChatInboundFacade({
      buildLanguageModel: contexts.buildLanguageModel,
      turnEntryCtx: contexts.turnEntryCtx,
      threadOpsCtx: contexts.threadOpsCtx,
      externalSessionsCtx: contexts.externalSessionsCtx,
    }),

    ...createChatUsageFacade({ repo, usageRepo, streamRegistry, requireSession }),
  }
}

export type ChatService = ReturnType<typeof createChatService>
