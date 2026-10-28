import type { ChatServiceDeps } from './service/context'
export type { SkillInput, SkillRecord } from './service/skills'
import { createChatServiceGraph } from './service/service-graph'
import { createSessionCore } from './service/session-core'
import { createOperationContexts } from './service/operation-contexts'
import { createChatRuntimeFacade } from './service/runtime-facade'
import { createChatSessionFacade } from './service/session-facade'
import { createChatMessageFacade } from './service/message-facade'
import { createChatInteractionFacade } from './service/interaction-facade'
import { createChatFileFacade } from './service/file-facade'
import { createChatUsageFacade } from './service/usage-facade'
import { createChatQueryFacade } from './service/query-facade'
import { createChatInboundFacade } from './service/inbound-facade'
import { createChatRecapFacade } from './service/recap-facade'
import { createChatSkillFacade } from './service/skill-facade'
import { listDelegatedRuns } from './service/delegated-runs'
import { createSubagentRows } from './service/subagent-rows'
import { createStatusLine } from './service/status-line'
import { statusLineUsage } from './service/status-line-usage'
import { statusLineModelInfo } from './service/status-line-model'
import { createModelContextRepository } from './model-context-repository'
import { createCcTranscript } from './runtime/run/cc-transcript'

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
    }),

    ...createChatInteractionFacade({ ...graph, deps }),

    ...createChatInboundFacade({
      buildLanguageModel: contexts.buildLanguageModel,
      turnEntryCtx: contexts.turnEntryCtx,
      threadOpsCtx: contexts.threadOpsCtx,
      externalSessionsCtx: contexts.externalSessionsCtx,
    }),

    ...createChatUsageFacade({ repo, usageRepo, streamRegistry, requireSession }),

    ...createChatRecapFacade({ recapService: contexts.recapService, requireSession }),

    // Claude Code's `statusLine`, drawn with the mods' status lines under the message box.
    statusLine: createStatusLine({
      requireSession,
      resolveSessionWorkingDir: core.resolveSessionWorkingDir,
      usage: (userId, sessionId) =>
        statusLineUsage(repo, createModelContextRepository(deps.db), userId, sessionId),
      modelInfo: statusLineModelInfo(deps),
      transcriptPath: async (userId, session, cwd) => {
        const transcript = createCcTranscript({ repo, userId, session, cwd })
        await transcript.refreshSession()
        return transcript.path
      },
      publish: (sessionId, text) => deps.mods?.composer.status(sessionId, 'statusLine', text),
      watched: (userId, sessionId) => streamRegistry.hasWatchers(userId, sessionId),
    }),

    // A plugin's `subagentStatusLine` over this conversation's subagent rows.
    ...createSubagentRows({
      requireSession,
      getSession: (userId, id) => repo.getSession(userId, id),
      buildSessionPluginCatalog: core.buildSessionPluginCatalog,
      resolveSessionWorkingDir: core.resolveSessionWorkingDir,
      listDelegatedRuns: (userId, id) => listDelegatedRuns(deps.db, usageRepo, userId, id),
      streamRegistry,
    }),
  }
}

export type ChatService = ReturnType<typeof createChatService>
