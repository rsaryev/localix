/**
 * LEGACY BLANK SEATS, FILLED ONCE.
 *
 * Wraps the repository reads that hand out a route so a seat stored without a model is resolved
 * through the route defaults on first read and written back; every later read sees the stored route.
 */
import type { ModelRoute, SessionAgentRoute, SessionRecord } from '../repository-types'
import type { RouteDefaults } from './session-route-defaults'

/** A narrow projection that carries a route plus enough identity to resolve it. */
type SeatProjection = ModelRoute & {
  id?: string
  projectId?: string | null
  agentId?: string | null
}

/**
 * The repository methods that hand out a route, wrapped so a legacy blank seat is filled ONCE
 * and written back. After that write every reader sees the stored route and nothing is
 * resolved again. Seats that hold a model pass through untouched.
 */
export function withResolvedRoutes<
  R extends {
    listSessions: (userId: string) => Promise<SessionRecord[]>
    getSession: (userId: string, id: string) => Promise<SessionRecord | null>
    listSessionAncestry: (userId: string, id: string) => Promise<SessionRecord[]>
    getExternalSession: (userId: string, externalKey: string) => Promise<SessionRecord | null>
    findSessionByParentAndSource: (
      userId: string,
      parentSessionId: string,
      sourceToolCallId: string,
    ) => Promise<SessionRecord | null>
    getSessionAgentRoute: (userId: string, id: string) => Promise<SeatProjection | null>
    getChatSessionProjection: (userId: string, id: string) => Promise<SeatProjection | null>
    listRecentChatSessions: (
      userId: string,
      opts?: { projectId?: string | null; limit?: number },
    ) => Promise<SeatProjection[]>
    insertSession: (record: SessionRecord) => Promise<void>
    updateSessionAgentRoute: (
      userId: string,
      id: string,
      agentId: string,
      route: Partial<ModelRoute>,
      opts?: { seeded?: boolean },
    ) => Promise<void>
  },
>(repo: R, defaults: RouteDefaults): R {
  const persist = async (userId: string, sessionId: string, seat: SessionAgentRoute) =>
    repo
      .updateSessionAgentRoute(
        userId,
        sessionId,
        seat.agentId,
        {
          modelId: seat.modelId,
          providerConnectionId: seat.providerConnectionId,
          reasoningEffort: seat.reasoningEffort,
        },
        { seeded: true },
      )
      .catch((error: unknown) => console.warn('[chat] could not store a seat route:', error))

  const apply = async (userId: string, session: SessionRecord): Promise<SessionRecord> => {
    const { session: next, filled } = await defaults.fillParty(userId, session)
    await Promise.all(filled.map((seat) => persist(userId, session.id, seat)))
    return next
  }
  const applyAll = (userId: string, sessions: SessionRecord[]) =>
    Promise.all(sessions.map((session) => apply(userId, session)))

  const one = async <T extends SeatProjection>(
    userId: string,
    seat: T | null,
  ): Promise<T | null> => {
    if (!seat || seat.modelId) return seat
    const decide = await defaults.sources(userId, seat.projectId ?? null)
    const route = decide(seat.agentId ?? '')
    if (!route.modelId) return seat
    const next = {
      ...seat,
      modelId: route.modelId,
      providerConnectionId: route.providerConnectionId,
      reasoningEffort: route.reasoningEffort,
    }
    if (seat.id && seat.agentId)
      await repo
        .updateSessionAgentRoute(
          userId,
          seat.id,
          seat.agentId,
          {
            modelId: next.modelId,
            providerConnectionId: next.providerConnectionId,
            reasoningEffort: next.reasoningEffort,
          },
          { seeded: true },
        )
        .catch(() => {})
    return next
  }

  return {
    ...repo,
    listSessions: async (userId) => applyAll(userId, await repo.listSessions(userId)),
    getSession: async (userId, id) => {
      const session = await repo.getSession(userId, id)
      return session ? apply(userId, session) : session
    },
    listSessionAncestry: async (userId, id) =>
      applyAll(userId, await repo.listSessionAncestry(userId, id)),
    getExternalSession: async (userId, externalKey) => {
      const session = await repo.getExternalSession(userId, externalKey)
      return session ? apply(userId, session) : session
    },
    findSessionByParentAndSource: async (userId, parentSessionId, sourceToolCallId) => {
      const session = await repo.findSessionByParentAndSource(
        userId,
        parentSessionId,
        sourceToolCallId,
      )
      return session ? apply(userId, session) : session
    },
    getSessionAgentRoute: async (userId, id) =>
      one(userId, await repo.getSessionAgentRoute(userId, id)),
    getChatSessionProjection: async (userId, id) =>
      one(userId, await repo.getChatSessionProjection(userId, id)),
    listRecentChatSessions: async (userId, opts) =>
      Promise.all(
        (await repo.listRecentChatSessions(userId, opts)).map((row) => one(userId, row)),
      ) as never,
    insertSession: async (record) => {
      await repo.insertSession(record)
      defaults.forget(record.userId)
    },
    updateSessionAgentRoute: async (userId, id, agentId, route, opts) => {
      await repo.updateSessionAgentRoute(userId, id, agentId, route, opts)
      defaults.forget(userId)
    },
  }
}
