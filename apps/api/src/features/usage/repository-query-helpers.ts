import { sql, type Expression, type ExpressionBuilder, type SqlBool } from 'kysely'

import type { AppDatabase } from '../../db'
import { toSqliteDateTime } from '../../lib/sqlite-time'
import { USAGE_AUXILIARY_KINDS, type UsageFilters } from './usage-types'

// Pure helpers for the usage ledger's range filters and keyset pagination.
// Split out of repository.ts so the date-comparison edge cases (which carry the
// bulk of the explanatory comments) stand on their own and stay unit-testable.

// usage_events.created_at is SQLite CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS").
// A date-only upper bound ("2026-06-14") string-compares BELOW every timestamp
// on that day ("2026-06-14 03:05:30" > "2026-06-14"), so `created_at <= to`
// would silently drop the whole end day. Expand a bare date to end-of-day so the
// range stays inclusive; full timestamps pass through untouched.
export const inclusiveTo = (to: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(to) ? `${to} 23:59:59` : to

// The same pitfall in the LOWER-bound direction: the UI sends `from` as an ISO
// string ("2026-06-13T12:00:00.000Z"), whose 'T' (0x54) string-compares ABOVE the
// space (0x20) in every same-day space-format row, so `created_at >= from` silently
// drops rows on the from-day that are chronologically AFTER `from` — undercounting
// the dashboard by ~a day. Normalize an ISO `from` to "YYYY-MM-DD HH:MM:SS"
// (re-parsed so any timezone offset is folded to the UTC column format). A bare
// date or already-space value compares fine and passes through untouched.
export const inclusiveFrom = (from: string): string =>
  from.includes('T') ? toSqliteDateTime(new Date(from)) : from

// Group spend by CALL KIND: the ledger records auxiliary LLM calls alongside
// visible chat turns — session-title generation ('title'), inline autocomplete ('autocomplete'),
// text-input completion ('inline-completion'), terminal command completion ('terminal'),
// historical prompt-rewrite calls ('improve', retired),
// the auto-mode permission classifier ('classify'), `prompt` CC-hook verdicts ('hook') and
// group-chat floor decisions ('routing'), every other decision-model call ('decision') —
// so a "Kind" breakdown surfaces how much spend is background overhead vs actual
// conversation. Everything else (the model's real stop reasons: end_turn /
// tool_use / max_tokens / null / …) folds into the 'turn' bucket. The bucket ids
// here are the contract the UI labels (see stats/ui/format.ts `kindLabel`) — keep
// the two in sync.
const usageKindCases = USAGE_AUXILIARY_KINDS.map(
  (kind) => sql`when finish_reason = ${kind} then ${kind}`,
)
export const usageKindKeyExpr = sql<string>`case ${sql.join(usageKindCases, sql.raw(' '))} else 'turn' end`

// The dashboard aggregate queries (stats / summary / trend) all narrow the
// `usage_events` ledger by the same optional range + model/provider/session
// filters. Build those conditions once as a typed expression list so each query
// applies an identical `.where((eb) => eb.and(usageFilterConditions(eb, opts)))`.
// Bare `usage_events` columns only — queryLogs uses table aliases and filters inline.
export function usageFilterConditions(
  eb: ExpressionBuilder<AppDatabase, 'usage_events'>,
  opts: UsageFilters,
): Expression<SqlBool>[] {
  const conds: Expression<SqlBool>[] = []
  if (opts.from) conds.push(eb('created_at', '>=', inclusiveFrom(opts.from)))
  if (opts.to) conds.push(eb('created_at', '<=', inclusiveTo(opts.to)))
  if (opts.model) conds.push(eb('model_id', '=', opts.model))
  if (opts.provider) conds.push(eb('provider_id', '=', opts.provider))
  if (opts.session) conds.push(eb('session_id', '=', opts.session))
  if (opts.agent) conds.push(eb('agent_id', '=', opts.agent))
  // The tree's root, or the root itself: a root session's own rows carry their own id as
  // `root_session_id`, but the OR keeps a row written before that was true from dropping out.
  if (opts.sessionTree) {
    conds.push(
      eb.or([
        eb('session_id', '=', opts.sessionTree),
        eb('root_session_id', '=', opts.sessionTree),
      ]),
    )
  }
  return conds
}

// The dashboard's stats (grouped) and summary (grand-total) aggregates select the
// identical token/cost/message columns over `usage_events` — only the GROUP BY
// and an extra leading key column differ. Build the shared column list once so the
// two queries can't drift apart.
export function usageAggregateColumns(eb: ExpressionBuilder<AppDatabase, 'usage_events'>) {
  return [
    eb.fn.sum<number>('input_tokens').as('inputTokens'),
    eb.fn.sum<number>('output_tokens').as('outputTokens'),
    eb.fn.sum<number>('cache_read_tokens').as('cacheReadTokens'),
    eb.fn.sum<number>('cache_write_tokens').as('cacheWriteTokens'),
    eb.fn.sum<number>('cache_write_1h_tokens').as('cacheWrite1hTokens'),
    eb.fn.sum<number>('reasoning_tokens').as('reasoningTokens'),
    eb.fn.sum<number>('total_tokens').as('totalTokens'),
    eb.fn.sum<number>('cost_usd').as('costUsd'),
    eb.fn.countAll<number>().as('messages'),
    eb.fn
      .sum<number>(eb.case().when('cost_source', '=', 'actual').then(1).else(0).end())
      .as('actualCostMessages'),
    eb.fn
      .sum<number>(eb.case().when('cost_source', '=', 'subscription').then(1).else(0).end())
      .as('subscriptionMessages'),
    eb.fn
      .sum<number>(
        eb.case().when('cost_source', '=', 'subscription').then(eb.ref('cost_usd')).else(0).end(),
      )
      .as('subscriptionCostUsd'),
  ] as const
}

/** The numeric shape every `usageAggregateColumns` row coerces to. */
export interface UsageAggregateTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheWrite1hTokens: number
  reasoningTokens: number
  totalTokens: number
  costUsd: number
  messages: number
  actualCostMessages: number
  subscriptionMessages: number
  subscriptionCostUsd: number
}

/** Shape of an aggregate row (possibly absent/null when a query returns no rows). */
type UsageAggregateRow = Partial<Record<keyof UsageAggregateTotals, number | null>> | undefined

/** Coerce a `usageAggregateColumns` row to plain numbers — the stats/summary queries share this. */
export function mapUsageAggregate(r: UsageAggregateRow): UsageAggregateTotals {
  return {
    inputTokens: Number(r?.inputTokens ?? 0),
    outputTokens: Number(r?.outputTokens ?? 0),
    cacheReadTokens: Number(r?.cacheReadTokens ?? 0),
    cacheWriteTokens: Number(r?.cacheWriteTokens ?? 0),
    cacheWrite1hTokens: Number(r?.cacheWrite1hTokens ?? 0),
    reasoningTokens: Number(r?.reasoningTokens ?? 0),
    totalTokens: Number(r?.totalTokens ?? 0),
    costUsd: Number(r?.costUsd ?? 0),
    messages: Number(r?.messages ?? 0),
    actualCostMessages: Number(r?.actualCostMessages ?? 0),
    subscriptionMessages: Number(r?.subscriptionMessages ?? 0),
    subscriptionCostUsd: Number(r?.subscriptionCostUsd ?? 0),
  }
}

// Opaque keyset cursor = base64("<created_at>|<message_id>").
export function encodeCursor(createdAt: string, messageId: string): string {
  return Buffer.from(`${createdAt}|${messageId}`, 'utf8').toString('base64url')
}
export function decodeCursor(cursor: string): [string, string] {
  const raw = Buffer.from(cursor, 'base64url').toString('utf8')
  const idx = raw.lastIndexOf('|')
  return idx === -1 ? [raw, ''] : [raw.slice(0, idx), raw.slice(idx + 1)]
}
