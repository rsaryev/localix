import { USAGE_KIND_LABELS } from '@localixai/api/usage-types'
import type { UsageKindKey } from '@localixai/api/client'

// Keep the stats panel API stable while sharing generic formatters with the rest
// of the UI layer.
export {
  formatBucketLabel,
  formatDuration,
  formatTokens,
  formatUsd,
  shortKey,
} from '@localixai/plugin-sdk/ui/utilities'

export function kindLabel(key: string): string {
  return USAGE_KIND_LABELS[key as UsageKindKey] ?? key
}

/**
 * A participant's name in the ledger: the handle its seat recorded, else the bare id.
 * The handle is what a room addresses a member by, so it is what the reader recognises;
 * the id is the fallback for a member seated before handles were kept, or deleted since.
 */
export function agentLabel(agent: { id: string; handle: string | null }): string {
  return agent.handle ? `@${agent.handle}` : agent.id.replace(/^builtin:/, '')
}

/** Just the provider segment (e.g. "openrouter"). */
export function providerLabel(key: string | null): string {
  if (!key) return '—'
  return key.split('/')[0] || key
}
/** Shared "Jun 7, 13:21" renderer: accepts an ISO string or a SQLite
 *  CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC); returns raw on parse failure. */
export function formatShortDateTime(raw: string): string {
  const iso = raw.includes('T') ? raw : raw.replace(' ', 'T') + 'Z'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return raw
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
