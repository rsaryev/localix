import { sql, type Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { mutableColumns, insertColumns } from './usage-event-columns'
import { createUsageQueries } from './usage-queries'
import { createUsageReconciliation } from './usage-reconciliation'
import type { UsageEventInput } from './usage-types'

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

/**
 * Usage/cost ledger over `usage_events`. Chat turns use assistant-message keys;
 * repeated auxiliary calls accumulate into stable kind/routing buckets. Backs
 * the spend dashboard and authoritative auxiliary session usage.
 */
export function createUsageRepository(db: Kysely<AppDatabase>) {
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

    ...createUsageReconciliation(db),

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

    ...createUsageQueries(db),
  }
  return repository
}

export type UsageRepository = ReturnType<typeof createUsageRepository>
