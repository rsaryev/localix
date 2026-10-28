import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { Bell } from 'lucide-react'
import { useLocation } from 'react-router'
import { filterEvents } from '@/shared/lib/notifications/eventCenter'
import { eventNeedsAction, retainActionableEvents } from '@/shared/lib/notifications/actionability'
import { routeEventOrigin } from '@/shared/lib/notifications/origin'
import { selectUnreadCount, useNotificationsStore } from '@/shared/lib/notifications/store'
import {
  notificationCommandRevision,
  subscribeNotificationCommands,
} from '@/shared/lib/notifications/commandRegistry'
import { Button } from '@localixai/kit/button'
import { ActionTooltip } from '@localixai/kit/tooltip'
import { PopoverContent } from '@localixai/kit/popover'
import { DEFAULT_JOURNAL_FILTERS, EventFilterBar, type JournalFilters } from './EventFilterBar'
import { EventRow } from './EventRow'
import { useJournalNavigation } from './useJournalNavigation'
import { useNativeChromeInset } from './useNativeChromeInset'
import { ActivitySection } from './ActivitySection'
import type { ActivityItem, UpdateOffer } from '@/shared/lib/background-activity/activityItems'

/** Heavy searchable journal, loaded only when the lightweight launcher opens it. */
export function NotificationCenterContent({
  anchorRef,
  onRequestClose,
  focusEntryId,
  activity,
}: {
  anchorRef: RefObject<HTMLButtonElement | null>
  onRequestClose: () => void
  /** Entry the centre was opened FOR — a surface's "Details" button. Opens expanded, scrolled to. */
  focusEntryId?: string
  /** What runs in the background now and the updates on offer — live, above the journal. */
  activity?: { items: readonly ActivityItem[]; updates: readonly UpdateOffer[] }
}) {
  const [filters, setFilters] = useState<JournalFilters>(DEFAULT_JOURNAL_FILTERS)
  // The "last hour / day" windows are measured from here: read when the journal opens and again
  // whenever a filter changes, never during render.
  const [filterClock, setFilterClock] = useState(Date.now)
  const changeFilters = (update: (current: JournalFilters) => JournalFilters) => {
    setFilterClock(Date.now())
    setFilters(update)
  }
  const entries = useNotificationsStore((state) => state.entries)
  const commandRevision = useSyncExternalStore(
    subscribeNotificationCommands,
    notificationCommandRevision,
    notificationCommandRevision,
  )
  const unread = useNotificationsStore(selectUnreadCount)
  const markRead = useNotificationsStore((state) => state.markRead)
  const markAllRead = useNotificationsStore((state) => state.markAllRead)
  const remove = useNotificationsStore((state) => state.remove)
  const clearHistory = useNotificationsStore((state) => state.clearHistory)
  const { pathname } = useLocation()
  const visibleOrigin = routeEventOrigin(pathname)
  const currentSessionId = visibleOrigin.kind === 'application' ? null : visibleOrigin.sessionId
  const listRef = useRef<HTMLUListElement>(null)
  const { inset: nativeChromeInset, sideOffset } = useNativeChromeInset(anchorRef)
  const { openOrigin, openSource, runAction } = useJournalNavigation({ markRead, onRequestClose })

  // A cold lazy mount happens after Radix's initial open-autofocus phase. Focus the
  // newest row here as well so keyboard entry is identical whether prefetch won or not.
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLButtonElement>('[data-event-row-trigger]')
      ?.focus({ preventScroll: true })
  }, [])

  const actionCount = useMemo(
    () => entries.filter((entry) => eventNeedsAction(entry, commandRevision)).length,
    [entries, commandRevision],
  )
  // What "Clear history" would remove — everything but pending work AND problems that are still
  // true. The button used to be shown whenever something was not actionable, so a journal of
  // nothing but open problems offered a Clear that removed nothing.
  const clearable = useMemo(
    () => entries.length - retainActionableEvents(entries, commandRevision).length,
    [entries, commandRevision],
  )
  const filtered = useMemo(
    () => filterEvents(entries, { ...filters, currentSessionId }, filterClock, commandRevision),
    [entries, filters, filterClock, currentSessionId, commandRevision],
  )

  return (
    <PopoverContent
      align="end"
      material="app"
      sideOffset={sideOffset}
      collisionPadding={{ top: nativeChromeInset + 8, right: 8, bottom: 8, left: 8 }}
      role="dialog"
      aria-label="Event Center"
      onOpenAutoFocus={(event) => {
        const firstRow = listRef.current?.querySelector<HTMLButtonElement>(
          '[data-event-row-trigger]',
        )
        if (!firstRow) return
        event.preventDefault()
        firstRow.focus()
      }}
      className="max-h-[min(42rem,var(--radix-popover-content-available-height))] w-[46rem] max-w-[calc(100vw-1rem)] gap-0 overflow-hidden p-0"
    >
      <div className="shrink-0 px-3 pt-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-foreground">Event Center</h2>
            <p className="mt-0.5 text-2xs text-text-faint">
              {entries.length} {entries.length === 1 ? 'event' : 'events'} · {unread} unread ·{' '}
              {actionCount} need action
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {unread > 0 && (
              <Button
                variant="ghost"
                size="xs"
                onClick={markAllRead}
                className="text-text-soft hover:bg-surface-hover"
              >
                Mark all read
              </Button>
            )}
            {clearable > 0 && (
              <ActionTooltip
                label={
                  clearable < entries.length
                    ? 'Clear settled history; pending actions and open problems are kept'
                    : 'Clear event history'
                }
              >
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={clearHistory}
                  className="text-text-faint hover:bg-surface-hover hover:text-status-error"
                >
                  Clear history
                </Button>
              </ActionTooltip>
            )}
          </div>
        </div>
      </div>

      {/* Live, between the title and the journal's filters: the filters filter only the journal. */}
      <ActivitySection items={activity?.items ?? []} updates={activity?.updates ?? []} />

      <div className="shrink-0 border-b border-border-soft px-3 pb-2.5">
        <EventFilterBar
          filters={filters}
          onChange={(next) => changeFilters((current) => ({ ...current, ...next }))}
          actionCount={actionCount}
          unread={unread}
          currentSessionId={currentSessionId}
          shown={filtered.length}
          total={entries.length}
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex min-h-32 flex-col items-center justify-center gap-1 px-4 py-8 text-center">
          <Bell className="size-4 text-text-faint" aria-hidden="true" />
          <p className="text-xs text-text-soft">
            {entries.length === 0 ? 'No events yet' : 'No events match these filters'}
          </p>
          {entries.length > 0 && (
            <Button
              variant="link"
              size="xs"
              onClick={() => changeFilters(() => DEFAULT_JOURNAL_FILTERS)}
              className="h-auto px-0 text-text-faint hover:text-foreground"
            >
              Reset filters
            </Button>
          )}
        </div>
      ) : (
        <ul
          ref={listRef}
          aria-label="Event journal"
          className="min-h-0 flex-1 overflow-y-auto py-1 scrollbar-thin"
        >
          {filtered.map((entry) => (
            <EventRow
              key={entry.id}
              entry={entry}
              focused={entry.id === focusEntryId}
              onRead={() => markRead(entry.id)}
              onRemove={() => remove(entry.id)}
              onOpen={openSource}
              onOpenTrace={(origin) => openOrigin(origin, entry.id)}
              onAction={runAction}
            />
          ))}
        </ul>
      )}
    </PopoverContent>
  )
}
