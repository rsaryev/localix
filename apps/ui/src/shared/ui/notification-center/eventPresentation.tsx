import { Bell, Bot, Hand, SquareTerminal, type LucideIcon } from 'lucide-react'
import type {
  EventTraceStep,
  NotificationCategory,
  NotificationSeverity,
} from '@/shared/lib/notifications/types'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { formatTimeAgo } from '@localixai/mini-app-sdk/ui/utilities'

/**
 * How one event looks, wherever the journal draws it. The row, its detail and the filters all read
 * these tables, so a category named "Agents" in the filter cannot be called "Agent" on the row.
 */

export const SEVERITY_COLOR: Record<NotificationSeverity, string> = {
  success: 'text-status-success',
  info: 'text-status-info',
  warning: 'text-status-warning',
  error: 'text-status-error',
}

export const SEVERITY_LABEL: Record<NotificationSeverity, string> = {
  error: 'Error',
  warning: 'Warning',
  success: 'Success',
  info: 'Information',
}

export const CATEGORY_LABEL: Record<NotificationCategory, string> = {
  'human-input': 'Human input',
  agent: 'Agents',
  terminal: 'Terminal',
  system: 'System',
}

export const CATEGORY_ICON: Record<NotificationCategory, LucideIcon> = {
  'human-input': Hand,
  agent: Bot,
  terminal: SquareTerminal,
  system: Bell,
}

export const TRACE_PHASE_CLASS: Record<NonNullable<EventTraceStep['phase']>, string> = {
  started: 'bg-status-info',
  succeeded: 'bg-status-success',
  failed: 'bg-status-error',
  cancelled: 'bg-text-faint',
  event: 'bg-foreground/45',
}

const EXACT_TIME_FORMATTER = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
})

export function exactTime(ts: number): string {
  return EXACT_TIME_FORMATTER.format(ts)
}

export function EventTimestamp({
  ts,
  exact,
  responsive = false,
  className,
}: {
  ts: number
  exact?: string
  responsive?: boolean
  className?: string
}) {
  const label = exact ?? exactTime(ts)
  return (
    <MetadataTooltip label={label}>
      <time dateTime={new Date(ts).toISOString()} aria-label={label} className={className}>
        {responsive ? (
          <>
            <span aria-hidden="true" className="max-sm:hidden">
              {label}
            </span>
            <span aria-hidden="true" className="sm:hidden">
              {formatTimeAgo(ts)}
            </span>
          </>
        ) : (
          <span aria-hidden="true">{formatTimeAgo(ts)}</span>
        )}
      </time>
    </MetadataTooltip>
  )
}
