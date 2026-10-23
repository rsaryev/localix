import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { UsageLogRow } from '@/shared/api/contracts'
import {
  formatDuration,
  formatShortDateTime,
  formatTokens,
  formatUsd,
  providerLabel,
  shortKey,
} from './format'
import { TextAction } from '@localixai/kit/text-action'
import { TABLE_TD } from './tableCells'

const TD = cn(TABLE_TD, 'whitespace-nowrap')

/**
 * One request row of the usage log. Split out of `LogsTable` when the body became
 * virtualized: the table now renders a window of rows, so the row needs its own
 * `data-index` + measure ref, and the table body stays readable.
 */
export function LogRow({
  row: r,
  index,
  measureRef,
  onOpenSession,
}: {
  row: UsageLogRow
  /** Virtual index — read by the virtualizer's `measureElement`. */
  index: number
  measureRef?: (node: HTMLTableRowElement | null) => void
  onOpenSession?: (sessionId: string) => void
}) {
  return (
    <tr
      ref={measureRef}
      data-index={index}
      className="border-b border-border-faint transition-colors last:border-0 hover:bg-surface-hover"
    >
      <td className={cn(TD, 'text-text-soft')}>{formatShortDateTime(r.createdAt)}</td>
      <td className={cn(TD, 'font-mono text-text-soft')} title={r.modelId}>
        {shortKey(r.modelId)}
      </td>
      <td className={cn(TD, 'text-text-soft')}>{providerLabel(r.providerId)}</td>
      <td className={cn(TD, 'max-w-[240px] truncate')}>
        {onOpenSession && r.sessionId ? (
          <TextAction
            onClick={() => onOpenSession(r.sessionId)}
            className="block max-w-full truncate text-text-soft underline-offset-2 hover:text-foreground hover:underline"
            tooltip={r.sessionTitle ? `Open "${r.sessionTitle}"` : 'Open this conversation'}
          >
            {r.sessionTitle ?? <span className="text-text-faint">Untitled</span>}
          </TextAction>
        ) : r.sessionTitle ? (
          <span className="text-text-soft" title={r.sessionTitle}>
            {r.sessionTitle}
          </span>
        ) : (
          <span className="text-text-faint">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-right tabular-nums text-text-soft font-medium')}>
        {r.totalTokens > 0 ? (
          formatTokens(r.totalTokens)
        ) : (
          <span className="text-text-soft/30">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-right tabular-nums text-text-faint')}>
        {formatTokens(r.inputTokens)}
      </td>
      <td className={cn(TD, 'text-right tabular-nums text-text-faint')}>
        {formatTokens(r.outputTokens)}
      </td>
      <td
        className={cn(TD, 'text-right tabular-nums text-text-faint')}
        title="Cache write (new cache)"
      >
        {r.cacheWriteTokens > 0 ? (
          formatTokens(r.cacheWriteTokens)
        ) : (
          <span className="text-text-soft/25">—</span>
        )}
      </td>
      <td
        className={cn(TD, 'text-right tabular-nums text-text-faint')}
        title="Cache read (cache hit)"
      >
        {r.cacheReadTokens > 0 ? (
          formatTokens(r.cacheReadTokens)
        ) : (
          <span className="text-text-soft/25">—</span>
        )}
      </td>
      <td className={cn(TD, 'text-right tabular-nums text-foreground')}>
        {formatUsd(r.costUsd)}
        {r.costSource === 'estimated' && (
          <span className="ml-0.5 text-text-faint" title="estimated from catalog pricing">
            ~
          </span>
        )}
        {r.costSource === 'subscription' && (
          <span
            className="ml-0.5 text-text-faint"
            title="subscription plan — estimated API-equivalent value, not metered per token"
          >
            †
          </span>
        )}
      </td>
      <td className={cn(TD, 'text-text-faint')}>{formatDuration(r.durationMs)}</td>
      <td className={TD}>
        <UsageKindBadge kind={r.usageKind} />
      </td>
      <td className={cn(TD, 'text-text-faint')}>{r.finishReason ?? '—'}</td>
    </tr>
  )
}

function UsageKindBadge({ kind }: { kind: UsageLogRow['usageKind'] }) {
  const label = kind === 'byok' ? 'BYOK' : kind === 'credits' ? 'Credits' : '—'
  return (
    <span
      className={cn(
        'rounded-sm px-1.5 py-0.5 text-2xs font-medium',
        kind === 'byok'
          ? 'bg-status-info/10 text-status-info/90'
          : kind === 'credits'
            ? 'bg-status-warning/10 text-status-warning/90'
            : 'text-text-faint',
      )}
    >
      {label}
    </span>
  )
}
