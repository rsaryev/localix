import { Coins } from 'lucide-react'
import type { ChatUsagePayload } from '@localixai/agent'
import type { MessageProviderMeta } from '@/shared/api/contracts'

/**
 * What one turn actually cost, and which model served it.
 *
 * Both were already streamed with every assistant message and rendered nowhere: usage only
 * appeared as a SESSION aggregate in the composer, and `providerMeta` was converted into the
 * UI model and then dropped. So the two questions someone asks about a specific turn — "which
 * model answered this, on which key" and "did prompt caching work HERE" — had no answer
 * anywhere in the app, while the session total said everything was fine on average.
 *
 * The cache numbers are the point. Cached input is what a working prefix cache looks like from
 * the outside; cache WRITES on a turn that should have hit are what a busted prefix looks
 * like. A session aggregate hides both inside a sum.
 *
 * Rendered inside the existing activity work item rather than as a new surface: the same data
 * on a fourth surface would be clutter, and this is the surface already answering "what did
 * this message do".
 */
export function MessageTurnCost({
  usage,
  provider,
}: {
  usage?: ChatUsagePayload
  provider?: MessageProviderMeta
}) {
  if (!usage && !provider) return null
  const rows: Array<{ label: string; value: string }> = []
  if (provider) {
    rows.push({
      label: 'Model',
      // The provider's own name plus the raw model id: a session can switch models mid-way,
      // so "which model produced THIS" is not answerable from the session's current pick.
      value: `${provider.providerName} · ${provider.modelId}`,
    })
    if (provider.keyLabel || provider.keyMasked) {
      rows.push({
        label: 'Key',
        value: [provider.keyLabel, provider.keyMasked].filter(Boolean).join(' '),
      })
    }
  }
  if (usage) {
    rows.push({
      label: 'Tokens',
      value: `${fmt(usage.inputTokens ?? 0)} in · ${fmt(usage.outputTokens ?? 0)} out`,
    })
    if (usage.reasoningTokens) rows.push({ label: 'Reasoning', value: fmt(usage.reasoningTokens) })
    // Absent and zero are different answers: a provider that reported no cache activity is
    // not the same as one that never reported. Only render what was reported.
    if (usage.cachedInputTokens !== undefined) {
      rows.push({ label: 'Cache read', value: fmt(usage.cachedInputTokens) })
    }
    if (usage.cacheWriteTokens !== undefined || usage.cacheWrite1hTokens !== undefined) {
      const long = usage.cacheWrite1hTokens ? ` (${fmt(usage.cacheWrite1hTokens)} 1h)` : ''
      rows.push({ label: 'Cache write', value: `${fmt(usage.cacheWriteTokens ?? 0)}${long}` })
    }
    if (usage.totalCost !== undefined) {
      // The source is part of the number: an estimate from the catalog and a figure the
      // provider metered are not the same claim, and a subscription turn is neither.
      rows.push({
        label: 'Cost',
        value: `$${usage.totalCost.toFixed(4)}${usage.costSource ? ` · ${usage.costSource}` : ''}`,
      })
    }
  }

  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
      {rows.map((row) => (
        <div key={row.label} className="col-span-2 grid grid-cols-subgrid items-baseline">
          <dt className="text-2xs text-text-faint">{row.label}</dt>
          <dd className="truncate text-2xs tabular-nums text-text-soft">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Icon for the section heading, kept beside the component that owns the section. */
export const turnCostIcon = Coins

const fmt = (value: number): string => value.toLocaleString()
