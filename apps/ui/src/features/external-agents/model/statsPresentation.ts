import type {
  ExternalAgentStats,
  StatBucket,
  TokenUsage,
} from '@localixai/api/external-agent-contracts'

export type ExternalStatsGroup = 'agent' | 'project' | 'model'

export function externalCacheRate(usage: TokenUsage | undefined): string {
  if (!usage) return '—'
  const prompt = usage.inputTokens + usage.cachedInputTokens + usage.cacheWriteTokens
  return prompt > 0 ? `${Math.round((usage.cachedInputTokens / prompt) * 100)}%` : '—'
}

export function externalStatsAxis(stats: ExternalAgentStats, group: ExternalStatsGroup) {
  const rows =
    group === 'agent' ? stats.byProvider : group === 'project' ? stats.byProject : stats.byModel
  const measured = Boolean(stats.usage)
  return {
    rows,
    measured,
    points: rows.map((row) => ({
      key: row.key,
      value: measured ? (row.usage?.totalTokens ?? 0) : row.sessions,
    })),
  }
}

export function statsBucketLabels(rows: readonly StatBucket[]): ReadonlyMap<string, string> {
  return new Map(rows.map((row) => [row.key, row.label ?? row.key]))
}
