import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Copy, LoaderCircle } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { formatEventForClipboard } from '@/shared/lib/notifications/eventCenter'
import { compactEventTrace } from '@/shared/lib/notifications/trace'
import type {
  NotificationAction,
  NotificationEntry,
  NotificationOrigin,
} from '@/shared/lib/notifications/types'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { Button } from '@localixai/kit/button'
import { IconButton } from '@localixai/kit/icon-button'
import { CATEGORY_ICON, CATEGORY_LABEL, EventTimestamp, relativeTime } from './eventPresentation'
import { EventTrace } from './EventTrace'

const COPY_LABEL = {
  idle: 'Copy event details',
  copied: 'Event details copied',
  failed: 'Clipboard unavailable',
} as const

/** The expanded half of a journal row: the full body, its provenance, its live actions, its trace. */
export function EventDetail({
  entry,
  actions,
  needsAction,
  runningActionId,
  onAction,
  onOpenTrace,
}: {
  entry: NotificationEntry
  /** Already filtered to the ones that can run in this process. */
  actions: readonly NotificationAction[]
  needsAction: boolean
  runningActionId: string | null
  onAction: (action: NotificationAction) => void
  onOpenTrace: (origin: NotificationOrigin) => void
}) {
  const [copyState, setCopyState] = useState<keyof typeof COPY_LABEL>('idle')
  const copyReset = useRef<ReturnType<typeof setTimeout> | null>(null)
  const CategoryIcon = CATEGORY_ICON[entry.category]
  const trace = compactEventTrace(entry.trace ?? [])

  useEffect(
    () => () => {
      if (copyReset.current) clearTimeout(copyReset.current)
    },
    [],
  )

  const copyEvent = async () => {
    try {
      const copied = await platformCapabilities().clipboard.writeText(
        formatEventForClipboard(entry),
      )
      setCopyState(copied ? 'copied' : 'failed')
    } catch {
      setCopyState('failed')
    }
    if (copyReset.current) clearTimeout(copyReset.current)
    copyReset.current = setTimeout(() => setCopyState('idle'), 1_800)
  }

  return (
    <div data-event-expanded className="border-t border-border-faint px-8 pb-3 pt-2">
      <div className="flex items-start gap-2">
        {entry.message ? (
          // `whitespace-pre-wrap`, because this is the ONE place a report is read in full and it is
          // written with structure: a line per problem, its fix indented under it, the engine's raw
          // words under that. Collapsing those newlines turned the only readable copy of a failure
          // back into a run-on paragraph.
          <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-text-soft">
            {entry.message}
          </p>
        ) : (
          <span className="min-w-0 flex-1" />
        )}
        <IconButton
          size="xs"
          aria-label="Copy event details"
          tooltip={COPY_LABEL[copyState]}
          onClick={() => void copyEvent()}
          className={cn(
            'shrink-0',
            copyState === 'copied' && 'text-status-success',
            copyState === 'failed' && 'text-status-error',
          )}
        >
          {copyState === 'copied' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </IconButton>
        <span className="sr-only" aria-live="polite">
          {copyState === 'idle' ? '' : COPY_LABEL[copyState]}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-text-faint">
        <span className="inline-flex items-center gap-1">
          <CategoryIcon className="size-3" aria-hidden="true" />
          {CATEGORY_LABEL[entry.category]}
        </span>
        {entry.origin.label && <span>{entry.origin.label}</span>}
        {/* When it happened was only in the copied text; it is the first thing an operator asks. */}
        <EventTimestamp ts={entry.ts} className="font-mono" />
        {entry.resolvedAt && <span className="text-status-success">Resolved</span>}
        {needsAction && <span className="text-status-warning">Needs action</span>}
        {(entry.occurrenceCount ?? 1) > 1 && (
          <span>
            First {relativeTime(entry.firstSeenAt ?? entry.ts)} · Last{' '}
            {relativeTime(entry.lastSeenAt ?? entry.ts)}
          </span>
        )}
      </div>

      {actions.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant="outline"
              size="sm"
              disabled={!action.available || runningActionId !== null}
              onClick={() => onAction(action)}
              className={cn(
                'border-control-border text-2xs hover:border-control-border-hover hover:bg-surface-active',
                action.target?.focus === 'interaction' && action.available
                  ? 'border-status-warning/40 text-status-warning'
                  : 'text-text-soft',
              )}
            >
              {runningActionId === action.id && (
                <LoaderCircle className="size-3 animate-spin" aria-hidden="true" />
              )}
              {action.label}
              {action.kind === 'navigate' && action.available && (
                <ArrowUpRight className="size-3" aria-hidden="true" />
              )}
            </Button>
          ))}
        </div>
      )}

      {trace.length > 0 && <EventTrace trace={trace} onOpenTrace={onOpenTrace} />}
    </div>
  )
}
