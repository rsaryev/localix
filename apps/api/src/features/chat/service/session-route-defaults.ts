/**
 * WHERE THE MODEL CHAIN IS APPLIED.
 *
 * `agent-route-resolution.ts` states the order — session, your last choice for this agent,
 * the agent's card, then the project. This puts that decision in front of every
 * reader, by wrapping the repository methods that hand out a route.
 *
 * It is one wrapper rather than a call at each consumer because there are sixty-eight places
 * that read a participant's model — the run, the compactor, the prompt, the picker, the
 * spawner, the hooks. Asking each of them to apply the chain is asking sixty-eight authors to
 * remember it, and the ones that forgot are exactly the bugs this replaces: a room seeded from
 * "whatever the user last used", an agent's own model that only one dispatcher ever read.
 *
 * The NARROW readers are wrapped too, not just the five that hand out a whole `SessionRecord`.
 * Inline completion and the channel projection each select three route columns
 * straight out of SQL, and a blank seat is now the ordinary state rather than a rarity — so
 * unwrapped they would read "no model" for a conversation that plainly has one. Everything that
 * leaves this repository carrying a route has been through the chain.
 *
 * What is STORED stays untouched. `conversation_participants` records only what was explicitly chosen for
 * that participant in that conversation; a blank there means "ask the next level", which is the
 * state the old code could not express. The write path never sees a resolved value — see
 * `writeMembership`, whose refusal to touch a survivor's route columns is what keeps that true.
 *
 * The lookups behind the chain are cached for a few seconds. A session list resolves two
 * hundred rows at once and they share a project and a registry; re-reading those per row would
 * turn one list into hundreds of filesystem reads. The window is short because a model changed
 * in settings should show up in the next breath, not the next restart.
 */
import { createBoundedCache } from '../../../lib/bounded-cache'
import type { ModelRoute, RecentRoutes, SessionRecord } from '../repository-types'
import {
  resolveParty,
  resolveSeatModel,
  routeCandidates,
  seedEffort,
} from '../agent-route-resolution'

/** What the chain needs from the rest of the app, and nothing else. */
export interface RouteDefaultsPorts {
  /** The project's configured model, if it has one. */
  loadProjectModelDefaults?: (
    userId: string,
    projectId: string,
  ) => Promise<Partial<ModelRoute> | null>
  /** The model on each agent's card, by agent ID, for the agents visible in this project. */
  loadAgentModelDefaults?: (
    userId: string,
    projectId: string | null,
  ) => Promise<Map<string, Partial<ModelRoute>>>
  /** The routes the user last chose, per agent and overall. */
  loadRecentRoutes?: (userId: string) => Promise<RecentRoutes>
  now?: () => number
}

const CACHE_TTL_MS = 5_000
const EMPTY_RECENT: RecentRoutes = { byAgent: new Map(), effortByAgent: new Map() }

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

export function createRouteDefaults(ports: RouteDefaultsPorts) {
  const now = ports.now ?? (() => Date.now())
  const projectMemo = memo<Partial<ModelRoute> | null>(CACHE_TTL_MS, now)
  const agentMemo = memo<Map<string, Partial<ModelRoute>>>(CACHE_TTL_MS, now)
  const recentMemo = memo<RecentRoutes>(CACHE_TTL_MS, now)

  /** Every level below the session, for one project scope. */
  const levels = async (userId: string, projectId: string | null) =>
    Promise.all([
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
    ])

  /** Fill one session's party. A session with no party is returned untouched. */
  const apply = async (userId: string, session: SessionRecord): Promise<SessionRecord> => {
    if (!session.agents?.length) return session
    const [project, agents, recent] = await levels(userId, session.projectId ?? null)
    return {
      ...session,
      agents: resolveParty(session.agents, {
        project,
        recentForAgent: (agentId) => recent.byAgent.get(agentId),
        agent: (agentId) => agents.get(agentId),
      }),
    }
  }

  const applyAll = async (userId: string, sessions: SessionRecord[]): Promise<SessionRecord[]> =>
    Promise.all(sessions.map((session) => apply(userId, session)))

  /**
   * Fill ONE seat, for the narrow readers that project three route columns instead of a record.
   * Same chain, same cache; only the shape around it differs.
   */
  const applyOne = async <T extends ModelRoute>(
    userId: string,
    seat: T & { projectId?: string | null; agentId?: string | null },
  ): Promise<T> => {
    const [project, agents, recent] = await levels(userId, seat.projectId ?? null)
    const agentId = seat.agentId ?? ''
    return {
      ...seat,
      ...resolveSeatModel({
        seat,
        project,
        recentForAgent: recent.byAgent.get(agentId),
        agent: agents.get(agentId),
      }),
    }
  }

  /**
   * The effort ONE new seat is born with.
   *
   * Effort is settled at birth rather than on read because it is the dial for the task in front
   * of you: a conversation started on `high` must stay on `high` when a level below it changes
   * later. The order it consults is the same one the model falls through — stated once, in
   * `routeCandidates`.
   */
  const seatEffort = async (userId: string, projectId: string | null, agentId: string) => {
    const [project, agents, recent] = await levels(userId, projectId)
    const lastUsed = recent.effortByAgent.get(agentId)
    return seedEffort(
      routeCandidates({
        project,
        ...(lastUsed ? { recentForAgent: { reasoningEffort: lastUsed } } : {}),
        agent: agents.get(agentId),
      }),
    )
  }

  /**
   * Forget what this user last chose.
   *
   * The "recent" level is read out of the seats, so any write to a seat can change it — and the
   * few-second window that makes a two-hundred-row list affordable would otherwise answer with a
   * snapshot taken before the write. Seen as a 409 on the very first inbound conversation: the
   * chat created a moment earlier had warmed the cache while the database was still empty.
   */
  const forget = (userId: string) => {
    recentMemo.drop(userId)
  }

  return { apply, applyAll, applyOne, seatEffort, forget }
}

export type RouteDefaults = ReturnType<typeof createRouteDefaults>

/** A narrow projection that carries a route plus enough identity to resolve it. */
type SeatProjection = ModelRoute & { projectId?: string | null; agentId?: string | null }

/**
 * The repository methods that hand out a route, each one resolved on the way out.
 *
 * Spelled as an explicit list rather than a proxy over everything: a proxy would also wrap the
 * writers, and a write must carry the STORED party, not the resolved one. Naming the readers
 * makes that boundary something a reader of this file can check.
 *
 * `getRecentProviderModel` is deliberately absent — it IS a level of the chain, and resolving
 * its answer through the chain would make the floor stand on itself.
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
    /** Wrapped to invalidate, not to change: a new seat can be the user's newest choice. */
    insertSession: (record: SessionRecord) => Promise<void>
    updateSessionAgentRoute: (
      userId: string,
      id: string,
      agentId: string,
      route: Partial<ModelRoute>,
    ) => Promise<void>
  },
>(repo: R, defaults: RouteDefaults): R {
  const one = async <T extends SeatProjection>(userId: string, seat: T | null) =>
    seat ? defaults.applyOne(userId, seat) : null
  return {
    ...repo,
    listSessions: async (userId) => defaults.applyAll(userId, await repo.listSessions(userId)),
    getSession: async (userId, id) => {
      const session = await repo.getSession(userId, id)
      return session ? defaults.apply(userId, session) : session
    },
    listSessionAncestry: async (userId, id) =>
      defaults.applyAll(userId, await repo.listSessionAncestry(userId, id)),
    getExternalSession: async (userId, externalKey) => {
      const session = await repo.getExternalSession(userId, externalKey)
      return session ? defaults.apply(userId, session) : session
    },
    findSessionByParentAndSource: async (userId, parentSessionId, sourceToolCallId) => {
      const session = await repo.findSessionByParentAndSource(
        userId,
        parentSessionId,
        sourceToolCallId,
      )
      return session ? defaults.apply(userId, session) : session
    },
    getSessionAgentRoute: async (userId, id) =>
      one(userId, await repo.getSessionAgentRoute(userId, id)),
    getChatSessionProjection: async (userId, id) =>
      one(userId, await repo.getChatSessionProjection(userId, id)),
    listRecentChatSessions: async (userId, opts) =>
      Promise.all(
        (await repo.listRecentChatSessions(userId, opts)).map((row) =>
          defaults.applyOne(userId, row),
        ),
      ),
    insertSession: async (record) => {
      await repo.insertSession(record)
      defaults.forget(record.userId)
    },
    updateSessionAgentRoute: async (userId, id, agentId, route) => {
      await repo.updateSessionAgentRoute(userId, id, agentId, route)
      defaults.forget(userId)
    },
  }
}
