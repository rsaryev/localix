import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { EmptyHint } from '@localixai/kit/empty-hint'
import { TextAction } from '@localixai/kit/text-action'
import type { UsageStatRow } from '@/shared/api/contracts'
import { formatTokens, formatUsd, shortKey } from './format'
import { TABLE_STICKY_HEAD, TABLE_TD, TABLE_TH } from './tableCells'

export function BreakdownTable({
  rows,
  totalCost,
  onSelect,
  selectedKey,
  labelKey = shortKey,
}: {
  rows: UsageStatRow[]
  totalCost: number
  /** Drill down: filter the whole panel by the clicked row's model/provider. */
  onSelect?: (key: string) => void
  selectedKey?: string
  /** Render a row's key (defaults to shortKey; e.g. kindLabel for the Kind grouping). */
  labelKey?: (key: string) => string
}) {
  if (rows.length === 0)
    return <EmptyHint className="py-6 text-xs">No usage recorded yet.</EmptyHint>
  return (
    // Scrollable: the number of distinct models/providers is unbounded, so cap the
    // viewport and let the list scroll rather than growing the page indefinitely.
    <div className="max-h-96 overflow-auto scrollbar-thin">
      <table className="w-full text-sm">
        <thead className={TABLE_STICKY_HEAD}>
          <tr className="border-b border-border-faint text-left text-text-faint">
            <th className={TABLE_TH}>Name</th>
            <th className={cn(TABLE_TH, 'text-right')}>Msgs</th>
            <th
              className={cn(TABLE_TH, 'text-right')}
              title="Total context tokens (includes cache)"
            >
              Context
            </th>
            <th className={cn(TABLE_TH, 'text-right')}>Output</th>
            <th className={cn(TABLE_TH, 'text-right')} title="Cache writes (new cache)">
              Cache↑
            </th>
            <th className={cn(TABLE_TH, 'text-right')} title="Cache reads (cache hit)">
              Cache↓
            </th>
            <th className={cn(TABLE_TH, 'text-right')}>Cost</th>
            <th className={cn(TABLE_TH, 'text-right')}>Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const share = totalCost > 0 ? Math.round((r.costUsd / totalCost) * 100) : 0
            const selected = selectedKey === r.key
            return (
              <tr
                key={r.key}
                className={cn(
                  'border-b border-border-faint transition-colors last:border-0 hover:bg-surface-hover',
                  selected && 'bg-surface-active',
                )}
              >
                <td className={cn(TABLE_TD, 'font-mono text-text-soft')} title={r.key}>
                  {onSelect ? (
                    <TextAction
                      onClick={() => onSelect(r.key)}
                      tooltip={`Filter by ${r.key}`}
                      className="block max-w-full truncate underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {labelKey(r.key)}
                    </TextAction>
                  ) : (
                    labelKey(r.key)
                  )}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {formatTokens(r.messages)}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {formatTokens(r.inputTokens)}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {formatTokens(r.outputTokens)}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {r.cacheWriteTokens > 0 ? (
                    formatTokens(r.cacheWriteTokens)
                  ) : (
                    <span className="text-text-soft/25">—</span>
                  )}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {r.cacheReadTokens > 0 ? (
                    formatTokens(r.cacheReadTokens)
                  ) : (
                    <span className="text-text-soft/25">—</span>
                  )}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-foreground')}>
                  {formatUsd(r.costUsd)}
                </td>
                <td className={cn(TABLE_TD, 'text-right tabular-nums text-text-faint')}>
                  {share}%
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
