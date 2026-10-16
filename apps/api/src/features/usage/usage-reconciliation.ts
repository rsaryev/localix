import { sql, type Kysely, type RawBuilder } from 'kysely'

import type { AppDatabase } from '../../db'
import { recoveredUsage } from './recovered-usage'
import { insertColumns } from './usage-event-columns'
import { USAGE_AUXILIARY_KINDS } from './usage-types'

const AUXILIARY_FINISH_REASONS = new Set<string>(USAGE_AUXILIARY_KINDS)

/** CASE is lazy in SQLite, so malformed legacy JSON never reaches json_extract. */
function safeMessageJsonValue<T>(path: string): RawBuilder<T | null> {
  return sql<T | null>`case when json_valid(message.payload_json) then json_extract(message.payload_json, ${path}) else null end`
}

function safeMessageJsonType(path: string): RawBuilder<string | null> {
  return sql<
    string | null
  >`case when json_valid(message.payload_json) then json_type(message.payload_json, ${path}) else null end`
}

export function createUsageReconciliation(db: Kysely<AppDatabase>) {
  return {
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
  }
}
