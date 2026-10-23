import { useEffect, useId, useRef, useState } from 'react'
import { ArrowUpRight, ChevronRight, X } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { MenuEntry } from '@localixai/mini-app-sdk/ui'
import { eventNeedsAction } from '@/shared/lib/notifications/actionability'
import { notificationCommandAvailable } from '@/shared/lib/notifications/commandRegistry'
import { notificationNavTarget } from '@/shared/lib/notifications/navigate'
import type {
  NotificationAction,
  NotificationEntry,
  NotificationOrigin,
} from '@/shared/lib/notifications/types'
import { Chip } from '@localixai/kit/chip'
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from '@localixai/kit/context-menu'
import { IconButton } from '@localixai/kit/icon-button'
import { MenuEntries } from '@localixai/kit/menu-entries'
import { MetadataTooltip } from '@localixai/kit/tooltip'
import { EventDetail } from './EventDetail'
import { moveRowFocus, removeRowFromKeyboard } from './eventRowKeyboard'
import {
  CATEGORY_ICON,
  CATEGORY_LABEL,
  EventTimestamp,
  SEVERITY_COLOR,
  SEVERITY_LABEL,
  exactTime,
} from './eventPresentation'

/**
 * The body's first line, for the collapsed row. A failure titled "Could not save the file" says
 * WHAT failed; the reason ("Permission denied") is in the body, and a person scanning the journal
 * should not have to expand every row to learn it.
 */
function bodyPreview(message: string | undefined): string | undefined {
  const first = message
    ?.split('\n')
    .find((line) => line.trim())
    ?.trim()
  return first || undefined
}

export function EventRow({
  entry,
  focused = false,
  onRead,
  onRemove,
  onOpen,
  onOpenTrace,
  onAction,
}: {
  entry: NotificationEntry
  /** Arrived here from a surface's "Details" button: open the detail rather than making them hunt. */
  focused?: boolean
  onRead: () => void
  onRemove: () => void
  onOpen: (entry: NotificationEntry) => void
  onOpenTrace: (origin: NotificationOrigin) => void
  onAction: (entry: NotificationEntry, action: NotificationAction) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(focused)
  const rowRef = useRef<HTMLLIElement | null>(null)
  const [runningActionId, setRunningActionId] = useState<string | null>(null)
  const descriptionId = useId()
  const CategoryIcon = CATEGORY_ICON[entry.category]
  const navTarget = notificationNavTarget(entry)
  const needsAction = eventNeedsAction(entry)
  const resolved = entry.resolvedAt != null
  const preview = bodyPreview(entry.message)
  const actions = (entry.actions ?? []).filter(
    (action) =>
      notificationCommandAvailable(action) &&
      !(
        action.kind === 'navigate' &&
        action.target &&
        navTarget &&
        action.target.sessionId === navTarget.sessionId &&
        action.target.projectId === navTarget.projectId
      ),
  )
  const entryExactTime = exactTime(entry.ts)

  // Reading the detail IS seeing the event. Expanding used to leave the row unread, so the badge kept
  // counting an error the person had just read in full.
  const setOpen = (next: boolean) => {
    setExpanded(next)
    if (next && !entry.read) onRead()
  }

  const activateAction = async (action: NotificationAction) => {
    if (runningActionId) return
    setRunningActionId(action.id)
    try {
      await onAction(entry, action)
    } finally {
      setRunningActionId(null)
    }
  }

  // Opened FOR this row: bring it into view, and it counts as read. Expanding a row the person cannot
  // see is the same as not answering their click.
  useEffect(() => {
    if (!focused) return
    rowRef.current?.scrollIntoView({ block: 'nearest' })
    if (!entry.read) onRead()
    // Only on arrival: a later read-state change must not scroll the list back here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused])

  const accessibleDescription = [
    `${SEVERITY_LABEL[entry.severity]} severity`,
    CATEGORY_LABEL[entry.category],
    entryExactTime,
    entry.message,
    entry.origin.label,
    !entry.read ? 'unread' : undefined,
    resolved ? 'resolved' : undefined,
    needsAction ? 'needs action' : undefined,
    (entry.occurrenceCount ?? 1) > 1 ? `${entry.occurrenceCount} occurrences` : undefined,
  ]
    .filter((part): part is string => Boolean(part))
    // A body that already ends its sentence must not be read out with a second full stop.
    .map((part) => part.trim().replace(/[.!?…]+$/, ''))
    .join('. ')

  // The row's actions, also on right-click: Remove is a hover-only icon, and Open sits behind a
  // 1.5rem slot that only exists when the event names a session.
  const rowMenu: MenuEntry[] = [
    {
      id: 'expand',
      label: expanded ? 'Collapse' : 'Expand',
      icon: ChevronRight,
      onSelect: () => setOpen(!expanded),
    },
    ...(navTarget
      ? ([
          { id: 'open', label: 'Open session', icon: ArrowUpRight, onSelect: () => onOpen(entry) },
        ] satisfies MenuEntry[])
      : []),
    { separator: true },
    { id: 'remove', label: 'Remove event', icon: X, danger: true, onSelect: onRemove },
  ]

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <li
          ref={rowRef}
          data-event-resolved={resolved ? '' : undefined}
          className={cn(
            'group relative border-b border-border-faint last:border-b-0',
            !entry.read && 'bg-foreground/[0.025]',
            needsAction && 'border-l-2 border-l-status-warning',
          )}
        >
          <span id={descriptionId} className="sr-only">
            {accessibleDescription}
          </span>
          <div className="grid min-h-10 grid-cols-[minmax(0,1fr)_1.5rem_9rem_1.5rem] items-center gap-1.5 px-2 hover:bg-surface-hover max-sm:grid-cols-[minmax(0,1fr)_1.5rem_4rem_1.5rem]">
            <button
              type="button"
              data-event-row-trigger
              aria-expanded={expanded}
              aria-describedby={descriptionId}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Delete"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} event: ${entry.title}`}
              onClick={() => setOpen(!expanded)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  moveRowFocus(event.currentTarget, event.key === 'ArrowDown' ? 'next' : 'previous')
                } else if (event.key === 'Home' || event.key === 'End') {
                  event.preventDefault()
                  moveRowFocus(event.currentTarget, event.key === 'Home' ? 'first' : 'last')
                } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
                  event.preventDefault()
                  setOpen(event.key === 'ArrowRight')
                } else if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey)) {
                  event.preventDefault()
                  removeRowFromKeyboard(event.currentTarget, onRemove)
                }
              }}
              className="flex min-w-0 items-center gap-2 rounded-sm py-1.5 text-left outline-none focus-ring"
            >
              <ChevronRight
                className={cn(
                  'size-3 shrink-0 text-text-faint transition-transform',
                  expanded && 'rotate-90',
                )}
              />
              <MetadataTooltip label={CATEGORY_LABEL[entry.category]}>
                <span className="relative shrink-0" aria-hidden="true">
                  <CategoryIcon
                    className={cn(
                      'size-3.5',
                      // A settled event keeps its category glyph but gives up its alarm colour:
                      // an answered question painted as loudly as a pending one reads as pending.
                      resolved ? 'text-text-faint' : SEVERITY_COLOR[entry.severity],
                    )}
                  />
                  {!entry.read && (
                    <span className="absolute -left-1 -top-1 size-1.5 rounded-full bg-status-info" />
                  )}
                </span>
              </MetadataTooltip>
              <span className="flex min-w-0 flex-1 items-baseline gap-2">
                <span
                  className={cn(
                    'min-w-0 shrink truncate text-xs font-medium',
                    resolved ? 'text-text-soft' : 'text-foreground',
                  )}
                >
                  {entry.title}
                </span>
                {preview && !expanded && (
                  <span
                    aria-hidden="true"
                    className="min-w-0 flex-1 truncate text-2xs text-text-faint"
                  >
                    {preview}
                  </span>
                )}
              </span>
              {resolved && (
                <Chip aria-hidden="true" tone="neutral" size="counter" className="shrink-0 px-1.5">
                  Resolved
                </Chip>
              )}
              {(entry.occurrenceCount ?? 1) > 1 && (
                <MetadataTooltip label={`${entry.occurrenceCount} occurrences`}>
                  <Chip
                    aria-hidden="true"
                    tone="neutral"
                    size="counter"
                    className="shrink-0 px-1.5 font-medium"
                  >
                    ×{entry.occurrenceCount}
                  </Chip>
                </MetadataTooltip>
              )}
            </button>
            {/* The slot reserves the control's own square from the ladder, so the row keeps its
            geometry whether or not the action renders. */}
            <span
              data-event-session-action
              className="flex size-[var(--chrome-control-sm)] items-center justify-center"
            >
              {navTarget && (
                <IconButton
                  onClick={() => onOpen(entry)}
                  aria-label={`Open session ${navTarget.sessionId}`}
                  tooltip={`Open session ${navTarget.sessionId}`}
                  size="sm"
                  className="border border-control-border text-text-soft hover:border-control-border-hover hover:bg-surface-active"
                >
                  <ArrowUpRight className="size-3" aria-hidden="true" />
                </IconButton>
              )}
            </span>
            <EventTimestamp
              ts={entry.lastSeenAt ?? entry.ts}
              responsive
              className="truncate text-right text-2xs tabular-nums text-text-faint"
            />
            <IconButton
              tone="danger"
              size="xs"
              aria-label={`Remove event: ${entry.title}`}
              tooltip="Remove event"
              onClick={onRemove}
              className="lx-hover-actions shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            >
              <X className="size-3.5" />
            </IconButton>
          </div>

          {expanded && (
            <EventDetail
              entry={entry}
              actions={actions}
              needsAction={needsAction}
              runningActionId={runningActionId}
              onAction={(action) => void activateAction(action)}
              onOpenTrace={onOpenTrace}
            />
          )}
        </li>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <MenuEntries entries={rowMenu} family="context" />
      </ContextMenuContent>
    </ContextMenu>
  )
}
