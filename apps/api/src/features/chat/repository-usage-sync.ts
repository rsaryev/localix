import { sql, type Kysely } from 'kysely'
import type { ChatUsagePayload } from '@localixai/agent'

import type { AppDatabase, StoredMessagePayload } from '../../db'

// Message-usage accounting: the single write seam into the covering
// `agent_message_usage` projection, plus the active-branch aggregate read over it.
// Split out of repository.ts; `syncMessageUsage` always writes through the caller's
// `exec`, so it stays a stateless export the message/session writers import directly.

interface ActiveBranchUsageRow {
  turns: number
  input_tokens: number | null
  output_tokens: number | null
  cached_input_tokens: number | null
  cache_write_tokens: number | null
  cache_write_1h_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  total_cost: number | null
  subscription_cost: number
  cost_source_count: number
  sole_cost_source: ChatUsagePayload['costSource'] | null
}

const accountingNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null

/**
 * Usage mutation authority for the covering projection. Keep this in the same
 * transaction as payload_json: the asynchronous billing ledger intentionally
 * has a crash gap, while session snapshots must not. There is no production
 * writer outside this repository today (the gallery was the last one); any
 * future usage writer must come through this seam.
 */
export const syncMessageUsage = async (
  exec: Kysely<AppDatabase>,
  messageId: string,
  payload: StoredMessagePayload,
  previous?: StoredMessagePayload,
  finalizing = false,
): Promise<void> => {
  const usage = payload.role === 'assistant' ? payload.usage : undefined
  const previousUsage = previous?.role === 'assistant' ? previous.usage : undefined
  if (!finalizing && JSON.stringify(usage) === JSON.stringify(previousUsage)) return
  if (!usage) {
    await exec.deleteFrom('agent_message_usage').where('message_id', '=', messageId).execute()
    return
  }
  const costSource =
    usage.costSource === 'actual' ||
    usage.costSource === 'estimated' ||
    usage.costSource === 'subscription'
      ? usage.costSource
      : null
  const values = {
    input_tokens: accountingNumber(usage.inputTokens),
    output_tokens: accountingNumber(usage.outputTokens),
    cached_input_tokens: accountingNumber(usage.cachedInputTokens),
    cache_write_tokens: accountingNumber(usage.cacheWriteTokens),
    cache_write_1h_tokens: accountingNumber(usage.cacheWrite1hTokens),
    reasoning_tokens: accountingNumber(usage.reasoningTokens),
    total_tokens: accountingNumber(usage.totalTokens),
    total_cost: accountingNumber(usage.totalCost),
    cost_source: costSource,
  }
  await exec
    .insertInto('agent_message_usage')
    .values({ message_id: messageId, ...values })
    .onConflict((conflict) => conflict.column('message_id').doUpdateSet(values))
    .execute()
}

export function createUsageQueries(db: Kysely<AppDatabase>) {
  return {
    /**
     * Whole active-branch turn usage without touching transcript JSON.
     *
     * `agent_message_usage` is maintained inside the message transaction, so it
     * has payload crash semantics rather than the asynchronous billing ledger's
     * write gap. The dangling-leaf fallback deliberately matches listMessages.
     */
    async getActiveBranchUsage(
      userId: string,
      sessionId: string,
    ): Promise<{ usage?: ChatUsagePayload; turns: number; subscriptionCost: number }> {
      const result = await sql<ActiveBranchUsageRow>`
        SELECT totals.*
        FROM (
          WITH RECURSIVE active_branch(id, parent_id) AS (
            SELECT message.id, message.parent_id
            FROM agent_sessions AS session
            JOIN agent_messages AS message ON message.id = session.leaf_id
            WHERE session.user_id = ${userId}
              AND session.id = ${sessionId}
              AND message.user_id = ${userId}
              AND message.session_id = ${sessionId}
            UNION
            SELECT parent.id, parent.parent_id
            FROM agent_messages AS parent
            JOIN active_branch AS child ON parent.id = child.parent_id
            WHERE parent.user_id = ${userId}
              AND parent.session_id = ${sessionId}
          ),
          scoped(id) AS (
            SELECT id FROM active_branch
            UNION ALL
            SELECT message.id
            FROM agent_messages AS message
            WHERE message.user_id = ${userId}
              AND message.session_id = ${sessionId}
              AND NOT EXISTS (SELECT 1 FROM active_branch)
          )
          SELECT
            coalesce(sum(
              CASE WHEN
                coalesce(usage.input_tokens, 0) > 0
                OR coalesce(usage.output_tokens, 0) > 0
                OR coalesce(usage.cached_input_tokens, 0) > 0
                OR coalesce(usage.cache_write_tokens, 0) > 0
                OR coalesce(usage.cache_write_1h_tokens, 0) > 0
                OR coalesce(usage.reasoning_tokens, 0) > 0
                OR coalesce(usage.total_tokens, 0) > 0
                OR coalesce(usage.total_cost, 0) > 0
              THEN 1 ELSE 0 END
            ), 0) AS turns,
            sum(usage.input_tokens) AS input_tokens,
            sum(usage.output_tokens) AS output_tokens,
            sum(usage.cached_input_tokens) AS cached_input_tokens,
            sum(usage.cache_write_tokens) AS cache_write_tokens,
            sum(usage.cache_write_1h_tokens) AS cache_write_1h_tokens,
            sum(usage.reasoning_tokens) AS reasoning_tokens,
            sum(coalesce(
              usage.total_tokens,
              CASE
                WHEN usage.input_tokens IS NOT NULL OR usage.output_tokens IS NOT NULL
                THEN coalesce(usage.input_tokens, 0) + coalesce(usage.output_tokens, 0)
                ELSE NULL
              END
            )) AS total_tokens,
            sum(usage.total_cost) AS total_cost,
            coalesce(sum(CASE
              WHEN usage.cost_source = 'subscription' THEN coalesce(usage.total_cost, 0)
              ELSE 0
            END), 0) AS subscription_cost,
            count(DISTINCT CASE
              WHEN coalesce(usage.total_cost, 0) > 0 THEN usage.cost_source
              ELSE NULL
            END) AS cost_source_count,
            min(CASE
              WHEN coalesce(usage.total_cost, 0) > 0 THEN usage.cost_source
              ELSE NULL
            END) AS sole_cost_source
          FROM scoped
          JOIN agent_message_usage AS usage ON usage.message_id = scoped.id
        ) AS totals
      `.execute(db)
      const row = result.rows[0]
      const turns = Number(row?.turns ?? 0)
      if (!row || turns === 0) return { turns: 0, subscriptionCost: 0 }

      const usage: ChatUsagePayload = { isSummary: true }
      const assign = (key: keyof ChatUsagePayload, value: number | null) => {
        if (value !== null) Object.assign(usage, { [key]: Number(value) })
      }
      assign('inputTokens', row.input_tokens)
      assign('outputTokens', row.output_tokens)
      assign('cachedInputTokens', row.cached_input_tokens)
      assign('cacheWriteTokens', row.cache_write_tokens)
      assign('cacheWrite1hTokens', row.cache_write_1h_tokens)
      assign('reasoningTokens', row.reasoning_tokens)
      assign('totalTokens', row.total_tokens)
      assign('totalCost', row.total_cost)
      if (row.cost_source_count > 1) usage.costSource = 'estimated'
      else if (row.cost_source_count === 1 && row.sole_cost_source) {
        usage.costSource = row.sole_cost_source
      }
      return { usage, turns, subscriptionCost: Number(row.subscription_cost) }
    },
  }
}
