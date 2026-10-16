import type { StorageUsage } from '@/shared/api/storageApi'

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** `1536` → `1.5 KB`. Decimal only while it is informative: three digits need none. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 100 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[unit]}`
}

/** The windows offered for removing or auto-removing old conversations. */
export const RETENTION_DAY_CHOICES = [30, 90, 180, 365] as const

export interface UsageLine {
  key: string
  label: string
  bytes: number
}

/** What the app's data is made of, largest first, without the zero lines. */
export function usageLines(usage: StorageUsage): UsageLine[] {
  const lines: UsageLine[] = [
    { key: 'messages', label: 'Conversation history', bytes: usage.messageBytes },
    { key: 'outputs', label: 'Tool outputs', bytes: usage.toolOutputBytes },
    { key: 'search', label: 'Search index', bytes: usage.searchIndexBytes },
  ]
  return lines.filter((line) => line.bytes > 0).sort((a, b) => b.bytes - a.bytes)
}

/** One sentence for the result of a count or a removal. */
export function pruneSummary(result: { sessions: number; bytes: number; dryRun: boolean }): string {
  if (result.sessions === 0) return 'No conversations are that old.'
  const noun = result.sessions === 1 ? 'conversation' : 'conversations'
  const size = formatBytes(result.bytes)
  return result.dryRun
    ? `${result.sessions} ${noun}, about ${size} of history, would be removed.`
    : `Removed ${result.sessions} ${noun}, about ${size} of history.`
}

/** The saved choice as a Select value; absent means keep everything. */
export const retentionValue = (days: number | undefined): string => (days ? String(days) : 'off')
