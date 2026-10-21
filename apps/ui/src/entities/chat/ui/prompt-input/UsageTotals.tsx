import type { ChatUsagePayload } from '@localixai/agent'
import { formatCost } from '../../model/usageFormat'
import { uncachedInputTokens } from '../../model/usageMath'

const tokens = new Intl.NumberFormat('en-US')

export function UsageTotals({ usage }: { usage?: ChatUsagePayload }) {
  if (!usage) return <p className="text-2xs text-text-faint">No recorded usage yet.</p>
  const rows: [string, number | undefined][] = [
    ['Total tokens', usage.totalTokens],
    ['Input', usage.inputTokens],
    ['Cached input', usage.cachedInputTokens],
    [
      'Uncached input',
      uncachedInputTokens(usage.inputTokens, usage.cachedInputTokens, usage.cacheWriteTokens),
    ],
    ['Cache write', usage.cacheWriteTokens],
    ['Cache write (1h)', usage.cacheWrite1hTokens],
    ['Output', usage.outputTokens],
    ['Reasoning', usage.reasoningTokens],
  ]
  return (
    <dl className="space-y-1.5 text-2xs">
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <div key={label} className="flex items-center justify-between gap-4">
            <dt className="text-text-faint">{label}</dt>
            <dd className="font-mono tabular-nums text-text-soft">{tokens.format(value)}</dd>
          </div>
        ),
      )}
      {usage.totalCost !== undefined && (
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-faint">
            {usage.costSource === 'subscription'
              ? 'Cost (plan, est.)'
              : usage.costSource === 'estimated'
                ? 'Cost (est.)'
                : 'Cost'}
          </dt>
          <dd className="font-mono tabular-nums text-text-soft">{formatCost(usage.totalCost)}</dd>
        </div>
      )}
    </dl>
  )
}
