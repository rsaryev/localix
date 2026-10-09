import { ApiError } from '../../../lib/errors'
import { readAvailability } from '../../capabilities/availability'
import { createFileWatchService } from '../../fs-watch/service'
import { discardSessionData } from '../../plugins/session-storage'
import { resolveDefaultProject } from '../../projects/default-project'
import type { SessionDetail } from '../contracts'
import { createModelContextRepository } from '../model-context-repository'
import { toSessionSummary, type SessionRecord } from '../repository'
import { discardSessionSandbox, projectWorkingDirPort } from '../session-cwd'
import type { ChatServiceDeps } from './context'
import { rootChangeFanout } from './root-change-fanout'
import type { ChatServiceGraph } from './service-graph'
import * as sessionDetail from './session-detail'
import type { SessionDetailContext } from './session-detail'
import type { SessionLifecycleCtx } from './session-lifecycle-contracts'
import { createSessionWorkspace } from './session-workspace'

/**
 * The session-scoped closures every operation group of the chat service is handed.
 *
 * `service-graph.ts` builds what closes over `deps` alone; what closes over a SESSION — its
 * ownership gate, its working directory, its read model, its lifecycle context — is formed
 * here, once, so the operation contexts and the facades share one `requireSession` and one
 * `publishSession` instead of each growing its own. They are declared in dependency order: the
 * workspace before the file watcher that resolves its root through it, the read model before
 * the lifecycle context that answers with it.
 */
export function createSessionCore(deps: ChatServiceDeps, graph: ChatServiceGraph) {
  const {
    now,
    repo,
    routeDefaults,
    usageRepo,
    projectsRepo,
    pluginRepo,
    hitlRegistry,
    streamRegistry,
    previewRegistry,
    previewTargets,
    pluginCommands,
    runner,
  } = graph

  const requireSession = async (userId: string, id: string): Promise<SessionRecord> => {
    const session = await repo.getSession(userId, id)
    if (!session) {
      throw new ApiError(404, 'session_not_found', 'Session not found')
    }
    return session
  }

  // Session workspace rooting + capability discovery (skills, plugin commands,
  // plugin catalog) — see session-workspace.ts. Declared ahead of its first consumer
  // (the file watcher below): leaving it below meant the watcher's resolveRoot closed
  // over a `const` declared later — legal only because the arrow defers, and a hidden
  // ordering constraint either way.
  const {
    resolveProjectWorkingDir,
    resolveSessionWorkingDir,
    gatherSessionSkills,
    gatherEnabledPluginCommands,
    buildSessionPluginCatalog,
  } = createSessionWorkspace({
    projectsRepo,
    pluginRepo,
    availabilityFor: (userId, agentId) => readAvailability(deps.db, { userId, agentId }),
    logger: deps.logger,
  })

  const resolveSessionWorkspaceMetadata = async (userId: string, sessionId: string) => {
    const session = await requireSession(userId, sessionId)
    return {
      rootPath: await resolveSessionWorkingDir(userId, session),
      projectId: session.projectId,
    }
  }

  // Lazily-armed file-tree change watcher. Local sessions only; an ssh/docker tree
  // is invisible to a local fs.watch.
  const fileWatchService = createFileWatchService({
    streamRegistry,
    // Quick-open's file-list memo and the root's language servers (root-change-fanout.ts).
    onRootChanged: rootChangeFanout(deps.lspManager),
    resolveRoot: async (userId, sessionId) => {
      const session = await requireSession(userId, sessionId)
      if ((session.executionBackend ?? 'local') !== 'local') return null
      return { root: await resolveSessionWorkingDir(userId, session), local: true }
    },
  })

  // The session read model (session-detail.ts) — the live-runtime overlays it needs
  // (queued / running / pending HITL / grants) only exist on the runner.
  const sessionDetailCtx: SessionDetailContext = {
    repo,
    modelContexts: createModelContextRepository(deps.db),
    usageRepo,
    projectsRepo,
    hitlRegistry,
    requireSession,
    runner,
    lspManager: deps.lspManager,
    // Read at call time: the plans service is forward-held, composed after chat.
    // Not composed yet → `undefined` ("unknown"), never `[]` ("none").
    plans: async (userId, sessionId) => deps.plans?.list({ userId, sessionId }),
    // Same forward-held read: the resume registry is composed after chat.
    resumePoints: async (userId, sessionId) => deps.resume?.list({ userId, sessionId }),
  }

  const getSessionDetail = (
    userId: string,
    id: string,
    opts?: { messageLimit?: number; deferToolDetails?: boolean },
  ): Promise<SessionDetail> => sessionDetail.getSessionDetail(sessionDetailCtx, userId, id, opts)

  const publishSession = (session: SessionRecord) => {
    streamRegistry.publish(session.userId, session.id, {
      type: 'session.updated',
      session: toSessionSummary(session),
    })
  }

  const sessionLifecycleCtx: SessionLifecycleCtx = {
    onSessionsDeleted: (userId, sessionIds) =>
      streamRegistry.publish(userId, '', { type: 'session.deleted', sessionIds }),
    activeAgentId: runner.activeAgentId,
    cancelAgentTurn: runner.cancelAgentTurn,
    resolveSessionAgent: deps.resolveSessionAgent,
    repo,
    streamRegistry,
    runner,
    closeSessionTerminals: deps.closeSessionTerminals,
    // Clear any pending relay (`browser` tool) commands when a session is deleted —
    // otherwise they only clear via their 22s timeout. Also drop the session's
    // remembered preview TARGET: it is otherwise pruned only when the agent CLOSES
    // the preview (previewTargets.clear in browser-options), so a deleted
    // session that had a detected dev-server URL would leak one PreviewTarget entry
    // per-session-ever. A deleted session can never drive its preview again.
    closeSessionPreview: (userId, sessionId) => {
      previewRegistry.closeForSession(userId, sessionId)
      previewTargets.clear(userId, sessionId)
      // Same rule for awaited plugin commands: a deleted session's pending
      // round-trips settle now instead of only via their timeout.
      pluginCommands.closeForSession(userId, sessionId)
    },
    // Close the deleted session's file-tree watcher (frees the inotify handle when the last
    // session sharing an isolated directory leaves it).
    releaseSessionWatch: (sessionId) => fileWatchService.release(sessionId),
    // …and the scratch directory that chat owned, if it had one (see session-cwd.ts).
    discardSessionSandbox: (userId, session) =>
      discardSessionSandbox(
        { getProjectWorkingDir: projectWorkingDirPort(projectsRepo) },
        userId,
        session,
      ),
    // …and every plugin's session-owned data, for each session of the deleted tree.
    discardSessionData: (sessionIds) => discardSessionData(sessionIds),
    now,
    resolveDefaultProjectId: async (userId) =>
      (await resolveDefaultProject(projectsRepo, userId, now)).id,
    // Whether a stated connection is one this user actually holds. Through the list the picker
    // itself reads, so "exists" here and "offered" there cannot mean different things.
    connectionExists: async (userId, connectionId) =>
      (await deps.providerConnectionsService.listConnections(userId)).connections.some(
        (connection) => connection.id === connectionId,
      ),
    // Only the effort is decided at birth; the model is left blank so the chain answers for it
    // on every read. Same chain, same cache — see `session-route-defaults.ts`.
    seatEffort: (userId, projectId, agentId) =>
      routeDefaults.seatEffort(userId, projectId, agentId),
    requireSession,
    getSessionDetail,
    publishSession,
    // Read at call time: the plans service is forward-held (built after chat, bootstrap
    // `session-services.ts`), and a mode change can only arrive once boot is done.
    onPermissionModeChanged: async (userId, sessionId, before, after) => {
      await deps.plans?.permissionModeChanged({ userId, sessionId }, before, after)
    },
  }

  return {
    requireSession,
    resolveProjectWorkingDir,
    resolveSessionWorkingDir,
    gatherSessionSkills,
    gatherEnabledPluginCommands,
    buildSessionPluginCatalog,
    resolveSessionWorkspaceMetadata,
    fileWatchService,
    sessionDetailCtx,
    getSessionDetail,
    publishSession,
    sessionLifecycleCtx,
  }
}

export type SessionCore = ReturnType<typeof createSessionCore>
