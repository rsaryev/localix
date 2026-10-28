import { sql, type ExpressionBuilder, type Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type {
  UsageStatRow,
  UsageSummary,
  UsageTrendPoint,
  UsageLogsPage,
  UsageKeys,
  UsageFilters,
  UsageGroupBy,
} from './usage-types'
import {
  inclusiveTo,
  inclusiveFrom,
  encodeCursor,
  decodeCursor,
  usageFilterConditions,
  usageAggregateColumns,
  usageKindKeyExpr,
  mapUsageAggregate,
} from './repository-query-helpers'

export function createUsageQueries(db: Kysely<AppDatabase>) {
  return {
    /**
     * Aggregate spend/usage for the dashboard. Groups by model or provider,
     * optionally bounded by an ISO time range. Reads the indexed ledger, not JSON.
     */
    async queryStats(opts: UsageFilters & { groupBy: UsageGroupBy }): Promise<UsageStatRow[]> {
      // 'kind' groups by a CASE over finish_reason (turn / title / …);
      // 'model'/'provider' group by their denormalized column. The same key
      // expression drives SELECT and GROUP BY so the alias and the grouping
      // can't drift. `.as()` is called on each concrete branch (not the union)
      // so its overloads resolve.
      const groupCol =
        opts.groupBy === 'provider'
          ? 'provider_id'
          : opts.groupBy === 'agent'
            ? 'agent_id'
            : 'model_id'
      const keyOf = (eb: ExpressionBuilder<AppDatabase, 'usage_events'>) =>
        opts.groupBy === 'kind' ? usageKindKeyExpr : eb.ref(groupCol)
      let q = db
        .selectFrom('usage_events')
        .where('user_id', '=', opts.userId)
        .select((eb) => [
          opts.groupBy === 'kind' ? usageKindKeyExpr.as('key') : eb.ref(groupCol).as('key'),
          ...usageAggregateColumns(eb),
        ])
        .groupBy((eb) => keyOf(eb))
        .orderBy('costUsd', 'desc')
        .where((eb) => eb.and(usageFilterConditions(eb, opts)))
      const rows = await q.execute()
      return rows.map((r) => ({ key: r.key ?? 'unknown', ...mapUsageAggregate(r) }))
    },

    /** Grand totals over an optional time range — the dashboard summary cards. */
    async querySummary(opts: UsageFilters): Promise<UsageSummary> {
      let q = db
        .selectFrom('usage_events')
        .where('user_id', '=', opts.userId)
        .select((eb) => usageAggregateColumns(eb))
        .where((eb) => eb.and(usageFilterConditions(eb, opts)))
      return mapUsageAggregate(await q.executeTakeFirst())
    },

    /** Cost/tokens bucketed by hour or day (UTC) for a spend-over-time chart. */
    async queryTrend(opts: UsageFilters & { bucket?: 'hour' | 'day' }): Promise<UsageTrendPoint[]> {
      // ISO timestamp prefix: 10 = YYYY-MM-DD (day), 13 = YYYY-MM-DDTHH (hour).
      const bucketLen = opts.bucket === 'hour' ? 13 : 10
      let q = db
        .selectFrom('usage_events')
        .where('user_id', '=', opts.userId)
        .select((eb) => [
          sql<string>`substr(${eb.ref('created_at')}, 1, ${sql.lit(bucketLen)})`.as('day'),
          eb.fn.sum<number>('total_tokens').as('totalTokens'),
          eb.fn.sum<number>('cost_usd').as('costUsd'),
          eb.fn.countAll<number>().as('messages'),
        ])
        .groupBy('day')
        .orderBy('day', 'asc')
        .where((eb) => eb.and(usageFilterConditions(eb, opts)))
      const rows = await q.execute()
      return rows.map((r) => ({
        day: String(r.day ?? ''),
        totalTokens: Number(r.totalTokens ?? 0),
        costUsd: Number(r.costUsd ?? 0),
        messages: Number(r.messages ?? 0),
      }))
    },

    /** Distinct model/provider/session/agent keys in the ledger — populates dashboard filters. */
    async queryKeys(userId: string): Promise<UsageKeys> {
      // Independent aggregates — fire them in parallel (one DB round-trip span).
      const [modelRows, providerRows, sessionRows, agentRows] = await Promise.all([
        db
          .selectFrom('usage_events')
          .where('user_id', '=', userId)
          .select('model_id')
          .distinct()
          .orderBy('model_id', 'asc')
          .execute(),
        db
          .selectFrom('usage_events')
          .where('user_id', '=', userId)
          .where('provider_id', 'is not', null)
          .select('provider_id')
          .distinct()
          .orderBy('provider_id', 'asc')
          .execute(),
        // Only sessions that actually have usage rows, newest first, with their titles.
        db
          .selectFrom('usage_events as ue')
          .leftJoin('agent_sessions as s', 's.id', 'ue.session_id')
          .where('ue.user_id', '=', userId)
          .select((eb) => [
            'ue.session_id as id',
            's.title as title',
            eb.fn.max('ue.created_at').as('lastAt'),
          ])
          .groupBy(['ue.session_id', 's.title'])
          .orderBy('lastAt', 'desc')
          .limit(200)
          .execute(),
        // Agents with spend, named by the name their session recorded. The name comes from
        // the session rather than the agent registry because the ledger must still name an agent
        // whose record has since been deleted — DISTINCT over the join would multiply an agent
        // used in many sessions, so the name is picked as a max().
        db
          .selectFrom('usage_events as ue')
          .leftJoin('agent_sessions as sa', (join) =>
            join.onRef('sa.agent_id', '=', 'ue.agent_id').onRef('sa.id', '=', 'ue.session_id'),
          )
          .where('ue.user_id', '=', userId)
          .where('ue.agent_id', 'is not', null)
          .select((eb) => ['ue.agent_id as id', eb.fn.max('sa.agent_name').as('name')])
          .groupBy('ue.agent_id')
          .orderBy('id', 'asc')
          .execute(),
      ])
      return {
        models: modelRows.map((r) => r.model_id).filter(Boolean),
        providers: providerRows.map((r) => r.provider_id).filter((p): p is string => Boolean(p)),
        sessions: sessionRows.map((r) => ({ id: String(r.id), title: r.title ?? null })),
        agents: agentRows.map((r) => ({ id: String(r.id), name: r.name ?? null })),
      }
    },

    /**
     * Paginated per-run request log. Keyset pagination on (created_at, message_id)
     * desc — scales past deep offsets and rides the (user_id, created_at) index.
     * Joins session title + provider auth kind for display.
     */
    async queryLogs(
      opts: UsageFilters & { cursor?: string | null; limit?: number },
    ): Promise<UsageLogsPage> {
      const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
      let q = db
        .selectFrom('usage_events as ue')
        .leftJoin('agent_sessions as s', 's.id', 'ue.session_id')
        .leftJoin('provider_connections as pc', 'pc.id', 'ue.provider_connection_id')
        .where('ue.user_id', '=', opts.userId)
        .select((eb) => [
          'ue.message_id as messageId',
          'ue.created_at as createdAt',
          'ue.session_id as sessionId',
          's.title as sessionTitle',
          'ue.model_id as modelId',
          'ue.provider_id as providerId',
          'ue.agent_id as agentId',
          'ue.input_tokens as inputTokens',
          'ue.output_tokens as outputTokens',
          'ue.cache_read_tokens as cacheReadTokens',
          'ue.cache_write_tokens as cacheWriteTokens',
          'ue.cache_write_1h_tokens as cacheWrite1hTokens',
          'ue.total_tokens as totalTokens',
          'ue.cost_usd as costUsd',
          'ue.cost_source as costSource',
          'ue.finish_reason as finishReason',
          'ue.duration_ms as durationMs',
          'ue.key_label as keyLabel',
          'ue.key_masked as keyMasked',
          eb.ref('pc.auth_type').as('authType'),
        ])
        .orderBy('ue.created_at', 'desc')
        .orderBy('ue.message_id', 'desc')
        .limit(limit + 1)
      if (opts.from) q = q.where('ue.created_at', '>=', inclusiveFrom(opts.from))
      // inclusiveTo: a bare-date `to` ("2026-06-15") must include that whole day —
      // created_at is "2026-06-15 HH:MM:SS", so a raw `<= "2026-06-15"` would drop
      // every event ON the end day (matches the aggregate queries above; was the
      // one range filter that missed the fix).
      if (opts.to) q = q.where('ue.created_at', '<=', inclusiveTo(opts.to))
      if (opts.model) q = q.where('ue.model_id', '=', opts.model)
      if (opts.provider) q = q.where('ue.provider_id', '=', opts.provider)
      if (opts.session) q = q.where('ue.session_id', '=', opts.session)
      if (opts.agent) q = q.where('ue.agent_id', '=', opts.agent)
      if (opts.sessionTree) {
        q = q.where((eb) =>
          eb.or([
            eb('ue.session_id', '=', opts.sessionTree!),
            eb('ue.root_session_id', '=', opts.sessionTree!),
          ]),
        )
      }
      if (opts.cursor) {
        const [cAt, cId] = decodeCursor(opts.cursor)
        // (created_at, message_id) strictly before the cursor, in desc order.
        q = q.where((eb) =>
          eb.or([
            eb('ue.created_at', '<', cAt),
            eb.and([eb('ue.created_at', '=', cAt), eb('ue.message_id', '<', cId)]),
          ]),
        )
      }
      const rows = await q.execute()
      const hasMore = rows.length > limit
      const page = hasMore ? rows.slice(0, limit) : rows
      const last = page[page.length - 1]
      const nextCursor =
        hasMore && last ? encodeCursor(String(last.createdAt), String(last.messageId)) : null
      return {
        rows: page.map((r) => ({
          messageId: String(r.messageId),
          createdAt: String(r.createdAt),
          sessionId: String(r.sessionId),
          sessionTitle: r.sessionTitle ?? null,
          modelId: String(r.modelId),
          providerId: r.providerId ?? null,
          agentId: r.agentId ?? null,
          inputTokens: Number(r.inputTokens ?? 0),
          outputTokens: Number(r.outputTokens ?? 0),
          cacheReadTokens: Number(r.cacheReadTokens ?? 0),
          cacheWriteTokens: Number(r.cacheWriteTokens ?? 0),
          cacheWrite1hTokens: Number(r.cacheWrite1hTokens ?? 0),
          totalTokens: Number(r.totalTokens ?? 0),
          costUsd: Number(r.costUsd ?? 0),
          costSource: String(r.costSource ?? 'estimated'),
          finishReason: r.finishReason ?? null,
          durationMs: r.durationMs == null ? null : Number(r.durationMs),
          usageKind:
            r.authType === 'api-key' ? 'byok' : r.authType === 'oauth-pkce' ? 'credits' : 'unknown',
          keyLabel: r.keyLabel ?? null,
          keyMasked: r.keyMasked ?? null,
        })),
        nextCursor,
      }
    },
  }
}
