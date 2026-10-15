/**
 * WHERE A SEAT GETS ITS STARTING ROUTE.
 *
 * A seat stores its model, connection and effort explicitly, and every reader takes it as
 * stored. This module supplies the sources `birthRoute` decides between — the user's last model
 * for an agent, the agent's card, the project, the per-model effort memory — for the two moments
 * a route is decided: a seat being born, and a legacy seat stored blank, which is filled ONCE on
 * first read and written back so it is never decided again.
 *
 * The lookups are cached for a few seconds: a session list can hold many legacy rows at once.
 */
import type { AgentModelSettings } from '@localixai/agent'
import { createBoundedCache } from '../../../lib/bounded-cache'
import type { ReasoningEffort } from '../../../db/types'
import type {
  ModelRoute,
  RecentRoutes,
  SessionAgentRoute,
  SessionRecord,
} from '../repository-types'
import { birthRoute, type SeatRoute } from '../agent-route-resolution'

export interface RouteDefaultsPorts {
  /** The project's configured model, if it has one. */
  loadProjectModelDefaults?: (
    userId: string,
    projectId: string,
  ) => Promise<Partial<ModelRoute> | null>
  /** The route on each agent's card, by agent ID, for the agents visible in this project. */
  loadAgentModelDefaults?: (
    userId: string,
    projectId: string | null,
  ) => Promise<Map<string, Partial<ModelRoute>>>
  /** The model the user last chose, per agent. */
  loadRecentRoutes?: (userId: string) => Promise<RecentRoutes>
  /** The per agent/model settings the picker writes — the effort memory. */
  loadAgentModelSettings?: (userId: string) => Promise<readonly AgentModelSettings[]>
  now?: () => number
}

const CACHE_TTL_MS = 5_000
const EMPTY_RECENT: RecentRoutes = { byAgent: new Map() }

interface CacheEntry<T> {
  at: number
  value: Promise<T>
}

/**
 * Memoize one async lookup for a few seconds.
 *
 * The PROMISE is cached, not its result: a session list resolves its rows concurrently, so
 * caching only settled values would still let two hundred rows start two hundred identical
 * reads before the first one finished.
 */
function memo<T>(ttl: number, now: () => number) {
  const entries = createBoundedCache<string, CacheEntry<T>>({ maxEntries: 64 })
  const read = (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key)
    if (hit && now() - hit.at < ttl) return hit.value
    const value = load()
    entries.set(key, { at: now(), value })
    // A rejected lookup must not be remembered: the chain treats an unavailable level as
    // absent, and caching the failure would keep a level absent long after it came back.
    void value.catch(() => entries.delete(key))
    return value
  }
  read.drop = (key: string) => entries.delete(key)
  return read
}

/** The level last chosen for one agent on one model, from the picker's memory. */
export function rememberedEffort(
  settings: readonly AgentModelSettings[],
  agentId: string,
  modelId: string,
): ReasoningEffort | undefined {
  const matches = settings.filter(
    (entry) => entry.agentId === agentId && entry.modelId === modelId && entry.effort,
  )
  // A namespaced model id names its provider; prefer the entry recorded against it.
  const provider = modelId.includes('/') ? modelId.slice(0, modelId.indexOf('/')) : undefined
  const entry = matches.find((candidate) => candidate.providerId === provider) ?? matches[0]
  return entry?.effort as ReasoningEffort | undefined
}

/** Decide one new seat's complete route. The one port every birth path is handed. */
export type SeatRouteFor = (
  userId: string,
  projectId: string | null,
  agentId: string,
  given?: { chosen?: Partial<ModelRoute> | null; primary?: Partial<ModelRoute> | null },
) => Promise<SeatRoute>

export function createRouteDefaults(ports: RouteDefaultsPorts) {
  const now = ports.now ?? (() => Date.now())
  const projectMemo = memo<Partial<ModelRoute> | null>(CACHE_TTL_MS, now)
  const agentMemo = memo<Map<string, Partial<ModelRoute>>>(CACHE_TTL_MS, now)
  const recentMemo = memo<RecentRoutes>(CACHE_TTL_MS, now)
  const settingsMemo = memo<readonly AgentModelSettings[]>(CACHE_TTL_MS, now)

  const sources = async (userId: string, projectId: string | null) => {
    const [project, agents, recent, settings] = await Promise.all([
      projectId && ports.loadProjectModelDefaults
        ? projectMemo(`${userId}/${projectId}`, () =>
            ports.loadProjectModelDefaults!(userId, projectId).catch(() => null),
          )
        : null,
      ports.loadAgentModelDefaults
        ? agentMemo(`${userId}/${projectId ?? ''}`, () =>
            ports.loadAgentModelDefaults!(userId, projectId).catch(() => new Map()),
          )
        : new Map<string, Partial<ModelRoute>>(),
      ports.loadRecentRoutes
        ? recentMemo(userId, () => ports.loadRecentRoutes!(userId).catch(() => EMPTY_RECENT))
        : EMPTY_RECENT,
      ports.loadAgentModelSettings
        ? settingsMemo(userId, () => ports.loadAgentModelSettings!(userId).catch(() => []))
        : [],
    ])
    return (
      agentId: string,
      given: { chosen?: Partial<ModelRoute> | null; primary?: Partial<ModelRoute> | null } = {},
    ): SeatRoute =>
      birthRoute({
        ...given,
        recentForAgent: recent.byAgent.get(agentId),
        agent: agents.get(agentId),
        project,
        effortForModel: (modelId) => rememberedEffort(settings, agentId, modelId),
      })
  }

  /** The complete route one NEW seat is born with. */
  const seatRoute: SeatRouteFor = async (userId, projectId, agentId, given) =>
    (await sources(userId, projectId))(agentId, given)

  /**
   * A party with every blank (legacy) seat given its model. Returns the filled seats so the
   * caller can persist them; a seat that already holds a model is never touched.
   */
  const fillParty = async (userId: string, session: SessionRecord) => {
    const filled: SessionAgentRoute[] = []
    if (!session.agents?.some((member) => !member.modelId)) return { session, filled }
    const decide = await sources(userId, session.projectId ?? null)
    let primary: SessionAgentRoute | undefined
    const agents = session.agents.map((member, index) => {
      let next = member
      if (!member.modelId) {
        const route = decide(member.agentId, { primary: index === 0 ? null : primary })
        if (route.modelId) {
          next = {
            ...member,
            modelId: route.modelId,
            providerConnectionId: route.providerConnectionId,
            reasoningEffort: route.reasoningEffort,
          }
          filled.push(next)
        }
      }
      if (index === 0) primary = next
      return next
    })
    return { session: { ...session, agents }, filled }
  }

  /** Forget cached lookups after a write that can change them. */
  const forget = (userId: string) => {
    recentMemo.drop(userId)
    settingsMemo.drop(userId)
  }

  return { seatRoute, fillParty, sources, forget }
}

export type RouteDefaults = ReturnType<typeof createRouteDefaults>

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
