import type { ReasoningEffort } from '../../db'
import { sessionRoute } from '../../contracts/session-route'
import type {
  ChannelModelOption,
  ChannelSessionSummary,
  ChannelWorkspaceApi,
} from './channel-contracts'

/** Raw session shape (a superset of ChannelSessionSummary) the chat service returns. */
/**
 * A created session as the service returns it: the party carries the route, because a
 * conversation with several agents runs several models and a single field could not say so.
 * A channel only ever drives a private chat, so its one participant IS the channel's model.
 */
interface CreatedChatSession extends Omit<RawChatSession, 'modelId' | 'reasoningEffort'> {
  agents: Array<{
    agentId: string
    handle: string
    providerConnectionId: string | null
    modelId: string
    reasoningEffort: ReasoningEffort
  }>
}

interface RawChatSession {
  id: string
  title: string
  projectId: string
  runtimeStatus: ChannelSessionSummary['runtimeStatus']
  /** The route of the session's own participant — a channel drives a private chat. */
  modelId: string
  reasoningEffort: ReasoningEffort
  updatedAt: string
  sessionKind: string
  providerConnectionId?: string | null
}

/**
 * Structural view of the host services a channel workspace drives — kept narrow
 * so the workspace stays decoupled from the concrete service classes.
 */
export interface ChannelWorkspaceDeps {
  userId: string
  chatService: {
    listRecentChatSessions(
      userId: string,
      opts?: { projectId?: string | null; limit?: number },
    ): Promise<RawChatSession[]>
    getChatSessionProjection(userId: string, sessionId: string): Promise<RawChatSession | null>
    /**
     * Returns the full session, whose model lives on its participant rather than on the row —
     * `toChannelSession` flattens the two shapes to the one a channel speaks.
     */
    createSession(
      userId: string,
      input: {
        title?: string
        projectId?: string
        providerConnectionId?: string | null
        modelId?: string
      },
    ): Promise<CreatedChatSession>
    stop(sessionId: string, callerUserId?: string): Promise<boolean>
    updateSession(
      userId: string,
      sessionId: string,
      /**
       * The model and effort belong to a PARTICIPANT, so they travel under `route` — a session
       * no longer has "a model". This port declared them flat, which the chat service silently
       * ignored: both channel operations below were no-ops. It only type-checked because the
       * shape happened to share `economyMode` with the real patch; removing that setting is
       * what exposed it.
       */
      patch: {
        route?: {
          providerConnectionId?: string
          modelId?: string
          reasoningEffort?: ReasoningEffort
        }
      },
    ): Promise<unknown>
    sessionUsageText(userId: string, sessionId: string): Promise<string>
    getPendingInteractionSessionId(requestId: string): string | null
    interact(
      requestId: string,
      action: 'respond' | 'dismiss',
      payload?: { answers?: unknown },
      callerUserId?: string,
    ): { ok: boolean; error?: string } | Promise<{ ok: boolean; error?: string }>
  }
  projectsService: {
    listProjects(userId: string): Promise<{ projects: Array<{ id: string; name: string }> }>
  }
  catalogService: {
    getCatalog(): Promise<{ models: Array<{ id: string; providerId: string }> }>
  }
  providerConnectionsService: {
    listConnections(
      userId: string,
    ): Promise<{ connections: Array<{ id: string; providerId: string }> }>
  }
}

const toChannelSession = (s: RawChatSession | CreatedChatSession): ChannelSessionSummary => {
  const route = 'agents' in s ? sessionRoute(s) : s
  return {
    id: s.id,
    title: s.title,
    projectId: s.projectId,
    runtimeStatus: s.runtimeStatus,
    modelId: route.modelId,
    reasoningEffort: route.reasoningEffort,
    updatedAt: s.updatedAt,
  }
}

/**
 * Build the channel workspace management surface — the same operations the UI
 * sidebar offers (list/create/switch/stop sessions, pick projects and models),
 * scoped to regular `chat` sessions of the host user. See ChannelWorkspaceApi.
 */
export function createChannelWorkspace(deps: ChannelWorkspaceDeps): ChannelWorkspaceApi {
  const { userId, chatService, projectsService, catalogService, providerConnectionsService } = deps

  const getRegularChat = async (sessionId: string): Promise<RawChatSession | null> => {
    const session = await chatService.getChatSessionProjection(userId, sessionId).catch(() => null)
    return session?.sessionKind === 'chat' ? session : null
  }
  const requireRegularChat = async (sessionId: string): Promise<RawChatSession> => {
    const session = await getRegularChat(sessionId)
    if (!session) throw new Error('Channel chat session not found')
    return session
  }
  const interactWithRegularChat = async (
    requestId: string,
    action: 'respond' | 'dismiss',
    payload?: { answers?: unknown },
  ): Promise<{ ok: boolean; error?: string }> => {
    const sessionId = chatService.getPendingInteractionSessionId(requestId)
    if (!sessionId || !(await getRegularChat(sessionId))) {
      return { ok: false, error: 'HITL request is no longer active' }
    }
    return chatService.interact(requestId, action, payload, userId)
  }

  return {
    async listProjects() {
      const { projects } = await projectsService.listProjects(userId)
      return projects.map((p) => ({ id: p.id, name: p.name }))
    },
    async listSessions(opts?: { projectId?: string | null; limit?: number }) {
      const sessions = await chatService.listRecentChatSessions(userId, opts)
      return sessions.map(toChannelSession)
    },
    async getSession(sessionId: string) {
      const session = await getRegularChat(sessionId)
      return session ? toChannelSession(session) : null
    },
    async createSession(input: { title?: string; projectId?: string }) {
      if (input.projectId !== undefined) {
        const { projects } = await projectsService.listProjects(userId)
        if (!projects.some((project) => project.id === input.projectId)) {
          throw new Error('Channel project not found')
        }
      }
      // No model is stated: a channel-created chat is an ordinary chat and takes the ordinary
      // answer — your last choice for this agent, the project's default, its card — resolved on
      // read (`agent-route-resolution.ts`) instead of copied from whatever ran last.
      const session = await chatService.createSession(userId, {
        title: input.title,
        ...(input.projectId ? { projectId: input.projectId } : {}),
      })
      if (session.sessionKind !== 'chat') throw new Error('Channel session creation failed')
      return toChannelSession(session)
    },
    async stopSession(sessionId: string) {
      if (!(await getRegularChat(sessionId))) return false
      return chatService.stop(sessionId, userId)
    },
    async listModels(): Promise<ChannelModelOption[]> {
      const [{ connections }, catalog] = await Promise.all([
        providerConnectionsService.listConnections(userId),
        catalogService.getCatalog(),
      ])
      const out: ChannelModelOption[] = []
      for (const connection of connections) {
        for (const model of catalog.models) {
          if (model.providerId === connection.providerId) {
            out.push({
              connectionId: connection.id,
              providerId: connection.providerId,
              modelId: model.id,
            })
          }
        }
      }
      return out
    },
    async setSessionModel(
      sessionId: string,
      input: { connectionId?: string; modelId: string; reasoningEffort?: ReasoningEffort },
    ) {
      await requireRegularChat(sessionId)
      if (input.connectionId) {
        const { connections } = await providerConnectionsService.listConnections(userId)
        if (!connections.some((connection) => connection.id === input.connectionId)) {
          throw new Error('Channel model connection not found')
        }
      }
      await chatService.updateSession(userId, sessionId, {
        route: {
          ...(input.connectionId ? { providerConnectionId: input.connectionId } : {}),
          modelId: input.modelId,
          ...(input.reasoningEffort ? { reasoningEffort: input.reasoningEffort } : {}),
        },
      })
    },
    async setSessionReasoning(sessionId: string, effort: ReasoningEffort) {
      await requireRegularChat(sessionId)
      await chatService.updateSession(userId, sessionId, { route: { reasoningEffort: effort } })
    },
    async getSessionUsage(sessionId: string) {
      await requireRegularChat(sessionId)
      return chatService.sessionUsageText(userId, sessionId)
    },
    async respondHitl(requestId: string, answers: unknown) {
      return interactWithRegularChat(requestId, 'respond', { answers })
    },
    async dismissHitl(requestId: string) {
      return interactWithRegularChat(requestId, 'dismiss')
    },
  }
}
