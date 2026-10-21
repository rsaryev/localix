import { sql, type Kysely, type RawBuilder } from 'kysely'

import type { AppDatabase } from '../../db'
import { recoveredUsage } from './recovered-usage'
import { insertColumns } from './usage-event-columns'
import { USAGE_AUXILIARY_KINDS } from './usage-types'

/**
 * A chat turn's usage-ledger row, derived from its assistant message: the one writer of chat-turn
 * rows. The ledger projector writes the messages a notice names; the boot reconcile scans every
 * assistant message for rows that disagree with theirs (`usage-reconciliation.ts`).
 */

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

/** Which assistant messages: by id, by session, or a keyset window `(afterId, throughId]`. */
export interface LedgerScope {
  messageIds?: readonly string[]
  sessionIds?: readonly string[]
  afterId?: string | null
  throughId?: string
}

/** Assistant messages with usage in `scope`; `residueOnly` keeps those whose row is off. */
export function selectLedgerSources(
  db: Kysely<AppDatabase>,
  scope: LedgerScope,
  residueOnly: boolean,
) {
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
  return (
    db
      .selectFrom('agent_messages as message')
      .innerJoin('agent_sessions as session', 'session.id', 'message.session_id')
      // A message recorded with no routing of its own falls back to the route of the session's
      // FIRST participant: a message with no model recorded is one this build cannot attribute
      // precisely, and the first participant is the answer the row had before rooms existed.
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
      .$if(Boolean(scope.messageIds || scope.sessionIds), (query) =>
        query.where((eb) =>
          eb.or([
            ...(scope.messageIds?.length ? [eb('message.id', 'in', scope.messageIds)] : []),
            ...(scope.sessionIds?.length ? [eb('message.session_id', 'in', scope.sessionIds)] : []),
          ]),
        ),
      )
      .$if(Boolean(scope.afterId), (query) => query.where('message.id', '>', scope.afterId!))
      .$if(scope.throughId !== undefined, (query) =>
        query.where('message.id', '<=', scope.throughId!),
      )
      // Guard json_type behind json_valid so one legacy/corrupt row cannot stop the rest.
      .where(sql<boolean>`${safeMessageJsonType('$.usage')} = 'object'`)
      // The reconcile returns only crash residue, so parsing and the write stay proportional to
      // damaged rows; the projector writes what it was told about.
      .$if(residueOnly, (query) =>
        query.where((eb) =>
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
            // Timing is optional: absent or malformed, the stored timing stays, and the same
            // no-op is not rediscovered on every boot.
            sql<boolean>`${safeMessageJsonType('$.timing.modelMs')} in ('integer', 'real') and ${modelMs} >= 0 and coalesce(event.duration_ms, -1) != ${modelMs}`,
          ]),
        ),
      )
      .execute()
  )
}

type LedgerSource = Awaited<ReturnType<typeof selectLedgerSources>>[number]

/** Write each message's row; returns how many were inserted or changed. */
export async function writeLedgerRows(
  db: Kysely<AppDatabase>,
  rows: readonly LedgerSource[],
): Promise<number> {
  let written = 0
  await db.transaction().execute(async (trx) => {
    for (const row of rows) {
      // A deterministic auxiliary id colliding with a message id is wildly unlikely, but must
      // never let this rewrite an accumulated aux row.
      if (row.finish_reason && AUXILIARY_FINISH_REASONS.has(row.finish_reason)) continue
      const usage = recoveredUsage(row.payload_json)
      if (!usage) continue
      const turn = usage.turnEnd

      const sessionModelId = row.model_id ?? ''
      const slash = sessionModelId.indexOf('/')
      const providerId =
        turn?.providerId ?? usage.providerId ?? (slash > 0 ? sessionModelId.slice(0, slash) : null)
      const rawModelId = usage.modelId
      const modelId =
        turn?.modelId ??
        (rawModelId
          ? providerId && rawModelId.startsWith(`${providerId}/`)
            ? rawModelId
            : providerId
              ? `${providerId}/${rawModelId}`
              : rawModelId
          : sessionModelId)
      // A later model switch makes the session's current connection stale for this message.
      // Retain it only when its model snapshot still agrees.
      const providerConnectionId =
        turn?.providerConnectionId ??
        (modelId === sessionModelId ? row.provider_connection_id : null)
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
            finishReason: turn?.finishReason ?? null,
            durationMs: usage.modelMs ?? null,
            keyId: turn?.keyId ?? null,
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
            // The turn's own routing, when the message states it; a guess never replaces one.
            ...(turn
              ? {
                  provider_id: sql<string | null>`excluded.provider_id`,
                  model_id: sql<string>`excluded.model_id`,
                }
              : {}),
            duration_ms: sql<number | null>`coalesce(excluded.duration_ms, duration_ms)`,
            finish_reason: sql<string | null>`coalesce(excluded.finish_reason, finish_reason)`,
            key_id: sql<string | null>`coalesce(excluded.key_id, key_id)`,
            key_label: sql<string | null>`coalesce(excluded.key_label, key_label)`,
            key_masked: sql<string | null>`coalesce(excluded.key_masked, key_masked)`,
            // Fill attribution in, never blank it out.
            agent_id: sql<string | null>`coalesce(excluded.agent_id, agent_id)`,
          }),
        )
        .executeTakeFirst()
      if ((result.numInsertedOrUpdatedRows ?? 0n) > 0n) written += 1
    }
  })
  return written
}
