import type { PersistedMessage } from '../contracts'
import type { createUsageRepository, UsageStatRow } from '../../usage/repository'
import type { UsageGroupBy } from '../../usage/usage-types'
import { hasRecordedUsage, type ChatUsagePayload } from '@localixai/agent'
import { summarizeSessionUsage, summarizeSessionUsageFromTurns } from '../../usage/session-summary'

type UsageRepo = ReturnType<typeof createUsageRepository>

export interface UsageOverviewOpts {
  from?: string
  to?: string
  groupBy: UsageGroupBy
  bucket: 'hour' | 'day'
  model?: string
  provider?: string
  session?: string
  agent?: string
}

export interface UsageLogsOpts {
  from?: string
  to?: string
  model?: string
  provider?: string
  session?: string
  agent?: string
  cursor?: string | null
  limit?: number
}

/**
 * One round-trip for the whole dashboard top section: summary + per-key
 * breakdown + time-bucketed trend, fetched in parallel.
 */
export async function usageOverview(usageRepo: UsageRepo, userId: string, opts: UsageOverviewOpts) {
  const filters = {
    from: opts.from,
    to: opts.to,
    model: opts.model,
    provider: opts.provider,
    session: opts.session,
    agent: opts.agent,
  }
  const [summary, stats, trend] = await Promise.all([
    usageRepo.querySummary({ userId, ...filters }),
    usageRepo.queryStats({ userId, ...filters, groupBy: opts.groupBy }),
    usageRepo.queryTrend({ userId, ...filters, bucket: opts.bucket }),
  ])
  return { summary, stats, trend }
}

export function usageLogs(usageRepo: UsageRepo, userId: string, opts: UsageLogsOpts) {
  return usageRepo.queryLogs({ userId, ...opts })
}

export function usageKeys(usageRepo: UsageRepo, userId: string) {
  return usageRepo.queryKeys(userId)
}

function auxiliarySubscriptionCost(ledgerByKind: UsageStatRow[]): number {
  let cost = 0
  for (const row of ledgerByKind) {
    if (row.key !== 'turn') cost += row.subscriptionCostUsd ?? 0
  }
  return cost
}

function formatSessionUsageSummary(
  summary: {
    usage?: ChatUsagePayload
    turns: number
    auxiliaryCalls: number
  },
  subscriptionCost: number,
): string {
  if (!summary.usage) return 'No usage recorded yet for this session.'
  const input = summary.usage.inputTokens ?? 0
  const output = summary.usage.outputTokens ?? 0
  const cached = summary.usage.cachedInputTokens ?? 0
  const cacheWrite = summary.usage.cacheWriteTokens ?? 0
  const total = summary.usage.totalTokens ?? input + output
  const cost = summary.usage.totalCost ?? 0
  const fmt = (n: number) => n.toLocaleString('en-US')
  const cachedPct = input > 0 ? Math.round((cached / input) * 100) : 0
  const lines = [
    '**Session usage**',
    `- Assistant turns: ${summary.turns}`,
    ...(summary.auxiliaryCalls > 0 ? [`- Auxiliary model calls: ${summary.auxiliaryCalls}`] : []),
    `- Input tokens: ${fmt(input)} (${fmt(cached)} cached, ${cachedPct}%)`,
    ...(cacheWrite > 0 ? [`- Cache-write tokens: ${fmt(cacheWrite)}`] : []),
    `- Output tokens: ${fmt(output)}`,
    `- Total tokens: ${fmt(total)}`,
  ]
  if (cost > 0) {
    if (subscriptionCost > 0 && subscriptionCost >= cost - 1e-9) {
      // Entirely a subscription plan: the figure is an API-equivalent estimate.
      lines.push(
        `- Plan usage: ~$${cost.toFixed(4)} (subscription — estimated API-equivalent, not metered)`,
      )
    } else if (subscriptionCost > 0) {
      // Mixed: separate the metered spend from the non-metered plan estimate.
      lines.push(
        `- Estimated cost: $${cost.toFixed(4)} (incl. ~$${subscriptionCost.toFixed(4)} subscription plan, not metered)`,
      )
    } else {
      lines.push(`- Estimated cost: $${cost.toFixed(4)}`)
    }
  }
  return lines.join('\n')
}

export function formatSessionUsage(
  messages: PersistedMessage[],
  ledgerByKind: UsageStatRow[] = [],
): string {
  let subscriptionCost = 0
  for (const m of messages) {
    const u = m.payload.usage
    if (m.payload.role !== 'assistant' || !hasRecordedUsage(u)) continue
    const turnCost = u.totalCost ?? 0
    // Subscription (OAuth plan) turns carry a catalog-estimated API-equivalent
    // value, NOT metered per-token spend — track it so the total isn't shown as
    // money actually billed. Mirrors the StatsPanel/LogsTable treatment.
    if (u.costSource === 'subscription') subscriptionCost += turnCost
  }
  return formatSessionUsageSummary(
    summarizeSessionUsage(messages, ledgerByKind),
    subscriptionCost + auxiliarySubscriptionCost(ledgerByKind),
  )
}

/** Format the same text without hydrating message payloads. */
export function formatSessionUsageFromTurns(
  turns: {
    usage?: ChatUsagePayload
    turns: number
    subscriptionCost: number
  },
  ledgerByKind: UsageStatRow[] = [],
): string {
  return formatSessionUsageSummary(
    summarizeSessionUsageFromTurns(turns, ledgerByKind),
    turns.subscriptionCost + auxiliarySubscriptionCost(ledgerByKind),
  )
}
