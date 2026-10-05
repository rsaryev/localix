import { sql, type ExpressionBuilder, type Kysely, type RawBuilder } from 'kysely'

import type { AppDatabase } from '../../db'
import { toSqliteDateTime } from '../../lib/sqlite-time'
import {
  USAGE_AUXILIARY_KINDS,
  type UsageEventInput,
  type UsageStatRow,
  type UsageSummary,
  type UsageTrendPoint,
  type UsageLogsPage,
  type UsageKeys,
  type UsageFilters,
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
} from './usage-query-helpers'

// Type contracts live in usage-types.ts. Re-export them here so the historical
// './repository' import surface (client.ts, usage-normalize, …) stays stable.
export type {
  UsageEventInput,
  UsageStatRow,
  UsageSummary,
  UsageTrendPoint,
  UsageOverview,
  UsageLogRow,
  UsageLogsPage,
  UsageKeys,
  UsageGroupBy,
} from './usage-types'
import type { UsageGroupBy } from './usage-types'

const AUXILIARY_FINISH_REASONS = new Set<string>(USAGE_AUXILIARY_KINDS)

type JsonObject = Record<string, unknown>

function jsonObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

function optionalFiniteNonnegative(object: JsonObject, key: string): number | null | undefined {
  const value = object[key]
  if (value === undefined) return undefined
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function optionalString(object: JsonObject | null, key: string): string | undefined {
  const value = object?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** CASE is lazy in SQLite, so malformed legacy JSON never reaches json_extract. */
function safeMessageJsonValue<T>(path: string): RawBuilder<T | null> {
  return sql<T | null>`case when json_valid(message.payload_json) then json_extract(message.payload_json, ${path}) else null end`
}

function safeMessageJsonType(path: string): RawBuilder<string | null> {
  return sql<
    string | null
  >`case when json_valid(message.payload_json) then json_type(message.payload_json, ${path}) else null end`
}

function sqliteCreatedAt(value: string): string | undefined {
  if (!value.includes('T')) return value
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? toSqliteDateTime(date) : undefined
}

function recoveredUsage(payloadJson: string) {
  try {
    const payload = jsonObject(JSON.parse(payloadJson))
    const usage = jsonObject(payload?.usage)
    if (!payload || !usage) return null
    const numericKeys = [
      'inputTokens',
      'outputTokens',
      'cachedInputTokens',
      'cacheWriteTokens',
      'cacheWrite1hTokens',
      'reasoningTokens',
      'totalTokens',
      'totalCost',
    ] as const
    const values = Object.fromEntries(
      numericKeys.map((key) => [key, optionalFiniteNonnegative(usage, key)]),
    ) as Record<(typeof numericKeys)[number], number | null | undefined>
    // Never turn malformed persisted accounting into a plausible zero row.
    if (Object.values(values).some((value) => value === null)) return null
    const costSourceValue = usage.costSource
    if (
      costSourceValue !== undefined &&
      costSourceValue !== 'actual' &&
      costSourceValue !== 'estimated' &&
      costSourceValue !== 'subscription'
    ) {
      return null
    }
    const providerMeta = jsonObject(payload.providerMeta)
    // The message's own author, which is the one attribution a repair can trust: the session's
    // party may have been re-ordered, or the member removed, since the row was written.
    const from = jsonObject(payload.from)
    const timing = jsonObject(payload.timing)
    const modelMs = timing ? optionalFiniteNonnegative(timing, 'modelMs') : undefined
    return {
      ...values,
      costSource: costSourceValue as UsageEventInput['costSource'],
      providerId: optionalString(providerMeta, 'providerId'),
      modelId: optionalString(providerMeta, 'modelId'),
      keyLabel: optionalString(providerMeta, 'keyLabel'),
      keyMasked: optionalString(providerMeta, 'keyMasked'),
      agentId: optionalString(from, 'agentId'),
      modelMs: modelMs === null ? undefined : modelMs,
    }
  } catch {
    return null
  }
}

/**
 * Usage/cost ledger over `usage_events`. Chat turns use assistant-message keys;
 * repeated auxiliary calls accumulate into stable kind/routing buckets. Backs
 * the spend dashboard and authoritative auxiliary session usage.
 */
export function createUsageRepository(db: Kysely<AppDatabase>) {
  const mutableColumns = (event: UsageEventInput) => ({
    provider_id: event.providerId ?? null,
    model_id: event.modelId,
    input_tokens: event.inputTokens ?? 0,
    output_tokens: event.outputTokens ?? 0,
    cache_read_tokens: event.cacheReadTokens ?? 0,
    cache_write_tokens: event.cacheWriteTokens ?? 0,
    cache_write_1h_tokens: event.cacheWrite1hTokens ?? 0,
    reasoning_tokens: event.reasoningTokens ?? 0,
    total_tokens: event.totalTokens ?? 0,
    cost_usd: event.costUsd ?? 0,
    cost_source: event.costSource ?? 'estimated',
    finish_reason: event.finishReason ?? null,
    duration_ms: event.durationMs ?? null,
    key_id: event.keyId ?? null,
    key_label: event.keyLabel ?? null,
    key_masked: event.keyMasked ?? null,
    // Mutable, not identity: a room rotates the party so the speaker is first, and a re-persist
    // of the same message re-derives the speaker the same way. Keeping it with the other
    // re-derived columns means a row written before the rotation landed is repaired, not frozen.
    agent_id: event.agentId ?? null,
  })

  const insertColumns = (event: UsageEventInput) => {
    const createdAt = event.createdAt ? sqliteCreatedAt(event.createdAt) : undefined
    return {
      message_id: event.messageId,
      session_id: event.sessionId,
      root_session_id: event.rootSessionId ?? null,
      user_id: event.userId,
      provider_connection_id: event.providerConnectionId ?? null,
      ...(createdAt ? { created_at: createdAt } : {}),
      ...mutableColumns(event),
    }
  }

  const repository = {
    /**
     * Append/replace a keyed usage-ledger row. For chat turns, repeated persists
     * of the same assistant message (streaming → final) never double-count.
     */
    async recordEvent(event: UsageEventInput): Promise<void> {
      // Columns rewritten on a repeated persist of the same message (streaming →
      // final). The immutable identity columns (message_id/session_id/root/user/
      // provider_connection_id) are set on insert only — see `.values()` below.
      const mutableCols = mutableColumns(event)
      await db
        .insertInto('usage_events')
        .values(insertColumns(event))
        .onConflict((oc) => oc.column('message_id').doUpdateSet(mutableCols))
        .execute()
    },

    /**
     * Repair the only crash window in normal-turn accounting: an assistant
     * message can commit with `payload.usage` immediately before the separate
     * ledger write. It also repairs a stale row from an earlier tool turn when
     * the final cumulative message committed just before the final ledger UPSERT.
     * Only canonical usage/cost numbers are reconciled on conflict; richer live
     * routing/key/finish metadata remains untouched, as do every auxiliary row.
     * Returns the number of inserted or numerically repaired rows.
     */
    async reconcileAssistantMessageEvents(): Promise<number> {
      let repaired = 0
      let afterId: string | null = null
      for (;;) {
        const page = await repository.reconcileAssistantMessagePage({ afterId, limit: 500 })
        repaired += page.repaired
        if (page.lastId === null) return repaired
        afterId = page.lastId
      }
    },

    /**
     * One keyset page of {@link reconcileAssistantMessageEvents}: the next `limit` assistant
     * messages after `afterId`. The whole-table form was ONE synchronous statement — ~230–300
     * ms on a cold page cache for a 60 MB database, every millisecond of it with the event loop
     * held — so the page bounds the ROWS SCANNED (ids first, off the assistant partial index),
     * not the rows matched: a filter-then-LIMIT would still walk the whole table when, as
     * usual, almost nothing needs repair. `maxBytes` also ends the window at the row whose
     * payload crosses it (never below one row): the cost is per BYTE parsed, and a 1.4 MB
     * payload beside a few small ones is a page of its own. `octet_length` reads the record
     * header, not the text. `lastId: null` means the scan is complete.
     */
    async reconcileAssistantMessagePage(page: {
      afterId: string | null
      limit: number
      maxBytes?: number
    }): Promise<{ repaired: number; lastId: string | null }> {
      const window = await db
        .selectFrom('agent_messages')
        .select(['id', sql<number>`octet_length(payload_json)`.as('bytes')])
        .where('role', '=', 'assistant')
        .$if(page.afterId !== null, (qb) => qb.where('id', '>', page.afterId!))
        .orderBy('id')
        .limit(page.limit)
        .execute()
      let lastId: string | undefined
      let bytes = 0
      for (const row of window) {
        if (lastId !== undefined && bytes + row.bytes > (page.maxBytes ?? Infinity)) break
        lastId = row.id
        bytes += row.bytes
      }
      if (lastId === undefined) return { repaired: 0, lastId: null }
      const inputTokens = safeMessageJsonValue<number>('$.usage.inputTokens')
      const outputTokens = safeMessageJsonValue<number>('$.usage.outputTokens')
      const cacheReadTokens = safeMessageJsonValue<number>('$.usage.cachedInputTokens')
      const cacheWriteTokens = safeMessageJsonValue<number>('$.usage.cacheWriteTokens')
      const cacheWrite1hTokens = safeMessageJsonValue<number>('$.usage.cacheWrite1hTokens')
      const reasoningTokens = safeMessageJsonValue<number>('$.usage.reasoningTokens')
      const totalTokens = safeMessageJsonValue<number>('$.usage.totalTokens')
      const totalCost = safeMessageJsonValue<number>('$.usage.totalCost')
      const costSource = safeMessageJsonValue<string>('$.usage.costSource')
      const modelMs = safeMessageJsonValue<number>('$.timing.modelMs')
      const rows = await db
        .selectFrom('agent_messages as message')
        .innerJoin('agent_sessions as session', 'session.id', 'message.session_id')
        // Repair falls back to the route of the session's FIRST participant when a message
        // recorded no model of its own. A room runs several, but a message with no model
        // recorded is by definition one this build cannot attribute precisely; the first
        // participant is the same answer the row would have had before the party existed.
        .leftJoin('conversation_participants as route', (join) =>
          join.onRef('route.session_id', '=', 'session.id').on('route.position', '=', 0),
        )
        .leftJoin('usage_events as event', 'event.message_id', 'message.id')
        .select([
          'message.id as message_id',
          'message.session_id',
          'message.user_id',
          'message.payload_json',
          'message.created_at',
          'session.root_session_id',
          'route.model_id',
          'route.agent_id',
          'route.provider_connection_id',
          'event.finish_reason',
        ])
        .where('message.role', '=', 'assistant')
        .$if(page.afterId !== null, (qb) => qb.where('message.id', '>', page.afterId!))
        .where('message.id', '<=', lastId)
        // Guard json_type behind json_valid so one legacy/corrupt row cannot
        // prevent every other recoverable event from being repaired at boot.
        .where(sql<boolean>`${safeMessageJsonType('$.usage')} = 'object'`)
        // Return only crash residue so JSON parsing + the repair transaction stay
        // proportional to damaged rows (the SQL scan itself runs in background).
        .where((eb) =>
          eb.or([
            eb('event.message_id', 'is', null),
            eb('event.input_tokens', '!=', sql<number>`coalesce(${inputTokens}, 0)`),
            eb('event.output_tokens', '!=', sql<number>`coalesce(${outputTokens}, 0)`),
            eb('event.cache_read_tokens', '!=', sql<number>`coalesce(${cacheReadTokens}, 0)`),
            eb('event.cache_write_tokens', '!=', sql<number>`coalesce(${cacheWriteTokens}, 0)`),
            eb(
              'event.cache_write_1h_tokens',
              '!=',
              sql<number>`coalesce(${cacheWrite1hTokens}, 0)`,
            ),
            eb('event.reasoning_tokens', '!=', sql<number>`coalesce(${reasoningTokens}, 0)`),
            eb(
              'event.total_tokens',
              '!=',
              sql<number>`coalesce(${totalTokens}, coalesce(${inputTokens}, 0) + coalesce(${outputTokens}, 0))`,
            ),
            eb('event.cost_usd', '!=', sql<number>`coalesce(${totalCost}, 0)`),
            sql<boolean>`${safeMessageJsonType('$.usage.costSource')} = 'text' and event.cost_source != ${costSource}`,
            // Timing is optional. If it is absent (or malformed), preserve richer
            // ledger timing and do not rediscover the same no-op on every boot.
            sql<boolean>`${safeMessageJsonType('$.timing.modelMs')} in ('integer', 'real') and ${modelMs} >= 0 and coalesce(event.duration_ms, -1) != ${modelMs}`,
          ]),
        )
        .execute()

      let repaired = 0
      await db.transaction().execute(async (trx) => {
        for (const row of rows) {
          // A deterministic auxiliary id colliding with a message id is wildly
          // unlikely, but must never let repair rewrite an accumulated aux row.
          if (row.finish_reason && AUXILIARY_FINISH_REASONS.has(row.finish_reason)) continue
          const usage = recoveredUsage(row.payload_json)
          if (!usage) continue

          const sessionModelId = row.model_id ?? ''
          const slash = sessionModelId.indexOf('/')
          const providerId = usage.providerId ?? (slash > 0 ? sessionModelId.slice(0, slash) : null)
          const rawModelId = usage.modelId
          const modelId = rawModelId
            ? providerId && rawModelId.startsWith(`${providerId}/`)
              ? rawModelId
              : providerId
                ? `${providerId}/${rawModelId}`
                : rawModelId
            : sessionModelId
          // A later model switch makes the session's current connection stale
          // for this message. Retain it only when its model snapshot still agrees.
          const providerConnectionId =
            modelId === sessionModelId ? row.provider_connection_id : null
          const inputTokens = usage.inputTokens ?? 0
          const outputTokens = usage.outputTokens ?? 0
          const result = await trx
            .insertInto('usage_events')
            .values(
              insertColumns({
                messageId: row.message_id,
                sessionId: row.session_id,
                rootSessionId: row.root_session_id ?? row.session_id,
                userId: row.user_id,
                createdAt: row.created_at,
                providerConnectionId,
                providerId,
                modelId,
                inputTokens,
                outputTokens,
                cacheReadTokens: usage.cachedInputTokens ?? 0,
                cacheWriteTokens: usage.cacheWriteTokens ?? 0,
                cacheWrite1hTokens: usage.cacheWrite1hTokens ?? 0,
                reasoningTokens: usage.reasoningTokens ?? 0,
                totalTokens: usage.totalTokens ?? inputTokens + outputTokens,
                costUsd: usage.totalCost ?? 0,
                costSource: usage.costSource,
                durationMs: usage.modelMs ?? null,
                keyLabel: usage.keyLabel ?? null,
                keyMasked: usage.keyMasked ?? null,
                agentId: usage.agentId ?? row.agent_id ?? null,
              }),
            )
            .onConflict((oc) =>
              oc.column('message_id').doUpdateSet({
                input_tokens: sql<number>`excluded.input_tokens`,
                output_tokens: sql<number>`excluded.output_tokens`,
                cache_read_tokens: sql<number>`excluded.cache_read_tokens`,
                cache_write_tokens: sql<number>`excluded.cache_write_tokens`,
                cache_write_1h_tokens: sql<number>`excluded.cache_write_1h_tokens`,
                reasoning_tokens: sql<number>`excluded.reasoning_tokens`,
                total_tokens: sql<number>`excluded.total_tokens`,
                cost_usd: sql<number>`excluded.cost_usd`,
                ...(usage.costSource ? { cost_source: sql<string>`excluded.cost_source` } : {}),
                duration_ms: sql<number | null>`coalesce(excluded.duration_ms, duration_ms)`,
                // Fill attribution in, never blank it out: a row written by a build that
                // recorded no speaker gains one from the message's author, and a row that
                // already names one keeps it when the message payload has since lost it.
                agent_id: sql<string | null>`coalesce(excluded.agent_id, agent_id)`,
              }),
            )
            .executeTakeFirst()
          if ((result.numInsertedOrUpdatedRows ?? 0n) > 0n) repaired += 1
        }
      })
      return { repaired, lastId }
    },

    /**
     * ADD a call's tokens/cost onto a running per-key ledger row (as opposed to
     * `recordEvent`, which overwrites). Used for high-frequency auxiliary calls —
     * inline autocomplete, text-input completion, and terminal completion — that
     * fire far too often to warrant a row each: they accumulate onto ONE stable-
     * keyed row per (session, kind) so the ledger and the request log stay compact
     * while the Kind breakdown still sums their true spend. The descriptive columns
     * (model/provider/cost_source/finish_reason/key) are snapshotted to the latest
     * call; the numeric columns are summed.
     */
    async accumulateEvent(event: UsageEventInput): Promise<void> {
      const add = {
        input_tokens: event.inputTokens ?? 0,
        output_tokens: event.outputTokens ?? 0,
        cache_read_tokens: event.cacheReadTokens ?? 0,
        cache_write_tokens: event.cacheWriteTokens ?? 0,
        cache_write_1h_tokens: event.cacheWrite1hTokens ?? 0,
        reasoning_tokens: event.reasoningTokens ?? 0,
        total_tokens: event.totalTokens ?? 0,
        cost_usd: event.costUsd ?? 0,
        duration_ms: event.durationMs ?? 0,
      }
      // Columns that describe the CALL (not the running total) — overwritten each write.
      const meta = {
        provider_id: event.providerId ?? null,
        model_id: event.modelId,
        cost_source: event.costSource ?? 'estimated',
        finish_reason: event.finishReason ?? null,
        key_id: event.keyId ?? null,
        key_label: event.keyLabel ?? null,
        key_masked: event.keyMasked ?? null,
      }
      await db
        .insertInto('usage_events')
        .values({
          message_id: event.messageId,
          session_id: event.sessionId,
          // An auxiliary caller (title, autocomplete, hook) knows only the session id.
          // It used to stamp that id as the ROOT too, which filed a child session's spend under a
          // tree of its own; the session row holds the real root, so read it from there.
          root_session_id:
            event.rootSessionId !== undefined
              ? event.rootSessionId
              : sql<
                  string | null
                >`(select coalesce(root_session_id, id) from agent_sessions where id = ${event.sessionId})`,
          user_id: event.userId,
          provider_connection_id: event.providerConnectionId ?? null,
          ...meta,
          ...add,
        })
        .onConflict((oc) =>
          // In SQLite's DO UPDATE, a bare column on the RHS is the EXISTING row's
          // value — so `input_tokens + ?` accumulates. duration_ms is nullable.
          oc.column('message_id').doUpdateSet({
            ...meta,
            input_tokens: sql<number>`input_tokens + ${add.input_tokens}`,
            output_tokens: sql<number>`output_tokens + ${add.output_tokens}`,
            cache_read_tokens: sql<number>`cache_read_tokens + ${add.cache_read_tokens}`,
            cache_write_tokens: sql<number>`cache_write_tokens + ${add.cache_write_tokens}`,
            cache_write_1h_tokens: sql<number>`cache_write_1h_tokens + ${add.cache_write_1h_tokens}`,
            reasoning_tokens: sql<number>`reasoning_tokens + ${add.reasoning_tokens}`,
            total_tokens: sql<number>`total_tokens + ${add.total_tokens}`,
            cost_usd: sql<number>`cost_usd + ${add.cost_usd}`,
            duration_ms: sql<number>`coalesce(duration_ms, 0) + ${add.duration_ms}`,
          }),
        )
        .execute()
    },

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
        // Agents with spend, named by the handle their seat recorded. The handle comes from
        // `conversation_participants` rather than the agent registry because the ledger must still name a
        // participant whose agent record has since been deleted — DISTINCT over the join would
        // multiply a member seated in many sessions, so the handle is picked as a max().
        db
          .selectFrom('usage_events as ue')
          .leftJoin('conversation_participants as sa', (join) =>
            join
              .onRef('sa.agent_id', '=', 'ue.agent_id')
              .onRef('sa.session_id', '=', 'ue.session_id'),
          )
          .where('ue.user_id', '=', userId)
          .where('ue.agent_id', 'is not', null)
          .select((eb) => ['ue.agent_id as id', eb.fn.max('sa.handle').as('handle')])
          .groupBy('ue.agent_id')
          .orderBy('id', 'asc')
          .execute(),
      ])
      return {
        models: modelRows.map((r) => r.model_id).filter(Boolean),
        providers: providerRows.map((r) => r.provider_id).filter((p): p is string => Boolean(p)),
        sessions: sessionRows.map((r) => ({ id: String(r.id), title: r.title ?? null })),
        agents: agentRows.map((r) => ({ id: String(r.id), handle: r.handle ?? null })),
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
  return repository
}

export type UsageRepository = ReturnType<typeof createUsageRepository>
