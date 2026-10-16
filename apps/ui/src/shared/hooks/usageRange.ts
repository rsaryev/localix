/**
 * Pure, dependency-free range helpers for the usage dashboard. Kept out of
 * useUsageStats.ts (which imports the backend client via the `@/` alias) so they
 * remain unit-testable in isolation under `bun test`.
 */
export type UsageRange = '7d' | '30d' | '90d' | 'all'

/** Resolve a preset range to an ISO `from` (or undefined for all-time). */
export function rangeToFromIso(range: UsageRange, nowMs: number): string | undefined {
  if (range === 'all') return undefined
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString()
}

/** Fine-grained buckets for short ranges, daily otherwise — keeps the chart legible. */
export function rangeToBucket(range: UsageRange): 'hour' | 'day' {
  return range === '7d' ? 'hour' : 'day'
}
