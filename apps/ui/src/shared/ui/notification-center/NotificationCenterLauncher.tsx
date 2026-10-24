import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

import { subscribeNotificationCenter } from '@/shared/lib/notificationCenterBus'
import { eventSignalKey, highestUnreadSeverity } from '@/shared/lib/notifications/signal'
import { selectUnreadCount, useNotificationsStore } from '@/shared/lib/notifications/store'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { Popover, PopoverTrigger } from '@localixai/kit/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { chromeAction, chromeActionActive } from '@localixai/kit/chrome-action'
import { Chip } from '@localixai/kit/chip'
import { ContextRing } from '@localixai/kit/context-ring'
import { useUiNavigation } from '@/shared/hooks/useUiNavigation'
import { useBackgroundActivity } from '@/shared/lib/background-activity/useBackgroundActivity'
import { navigateUi } from '@/shared/lib/uiNavigation'
import { settingsUiUri } from '@localixai/mini-app-sdk/navigation'
// Shared with contributed status items — a severity paints the same way wherever it appears.
import { STATUS_BADGE_CLASS } from '@localixai/kit/status-tone'
import { NOTIFICATION_CENTER_OVERLAY_ID } from './NotificationCenter.surface'
import type { NotificationSeverity } from '@/shared/lib/notifications/types'
import type { NotificationCenterContent } from './NotificationCenter'

let contentModule:
  | Promise<{
      default: typeof NotificationCenterContent
    }>
  | undefined

/** Warm the journal on user intent while keeping it out of the cold-start graph. */
export function preloadNotificationCenter() {
  contentModule ??= import('./NotificationCenter').then(({ NotificationCenterContent }) => ({
    default: NotificationCenterContent,
  }))
  return contentModule
}

const LazyNotificationCenterContent = lazy(preloadNotificationCenter)

/** "Event Center, 2 tasks in progress, 3 unread": what the bell is showing, in words. */
function bellLabel(active: number, unread: number): string {
  return [
    'Event Center',
    active > 0 && `${active} ${active === 1 ? 'task' : 'tasks'} in progress`,
    unread > 0 && `${unread} unread`,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Always-present event signal; the detailed journal is instantiated on demand. While anything
 * runs in the background the glyph sits in a thin ring that fills as the jobs do (it turns
 * slowly when none can say how far it is); the unread badge stays as it is.
 *
 * `restartToUpdate` is the page's (it needs the chat roster): the Event Center's offer of the
 * app's own update restarts through the same flow as the titlebar button.
 */
export function NotificationCenterLauncher({
  restartToUpdate,
}: { restartToUpdate?: () => void } = {}) {
  const [open, setOpen] = useState(false)
  const navigation = useUiNavigation({ sessionId: null })
  const openPlugins = useCallback(() => {
    setOpen(false)
    navigateUi(settingsUiUri('plugins'), navigation)
  }, [navigation])
  const activity = useBackgroundActivity({ openPlugins, restartToUpdate })
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [signal, setSignal] = useState<{ id: string; severity: NotificationSeverity } | null>(null)
  const entries = useNotificationsStore((state) => state.entries)
  const unread = useNotificationsStore(selectUnreadCount)
  const unreadSeverity = highestUnreadSeverity(entries)
  const initialLatestSignal = useRef(eventSignalKey(entries[0]))

  useEffect(() => {
    const latest = entries[0]
    if (!latest) {
      initialLatestSignal.current = undefined
      return
    }
    const nextSignal = eventSignalKey(latest)
    if (nextSignal === initialLatestSignal.current) return
    initialLatestSignal.current = nextSignal
    if (latest.read) return
    setSignal({ id: latest.id, severity: latest.severity })
    const timer = window.setTimeout(() => setSignal(null), 2_400)
    return () => window.clearTimeout(timer)
  }, [entries])

  // The entry a surface's "Details" button asked for. Cleared on close so the next plain open of
  // the bell is an ordinary list, not a re-focus on something already dealt with.
  const [focusEntryId, setFocusEntryId] = useState<string | undefined>(undefined)

  const openCenter = useCallback((entryId?: string) => {
    void preloadNotificationCenter()
    setFocusEntryId(entryId)
    setOpen(true)
  }, [])

  useEffect(() => subscribeNotificationCenter(openCenter), [openCenter])
  // The overlay bus hands its listener a params object; the bell opens plain, on no entry.
  useEffect(
    () => subscribeUiOverlay(NOTIFICATION_CENTER_OVERLAY_ID, () => openCenter()),
    [openCenter],
  )

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    if (nextOpen) void preloadNotificationCenter()
    else setFocusEntryId(undefined)
    setOpen(nextOpen)
  }, [])
  const label = bellLabel(activity.active, unread)

  return (
    <>
      {/* One polite announcement for the whole counter, phrased. Kept outside the button so the
          badge can stay decorative and the count is never read as a bare number. */}
      <span className="sr-only" aria-live="polite">
        {unread > 0 ? `${unread} unread ${unread === 1 ? 'notification' : 'notifications'}` : ''}
      </span>
      <Popover open={open} onOpenChange={handleOpenChange}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                ref={triggerRef}
                type="button"
                aria-label={label}
                aria-haspopup="dialog"
                onPointerEnter={() => void preloadNotificationCenter()}
                onFocus={() => void preloadNotificationCenter()}
                // The control keeps the ordinary chrome appearance in every state. It used to take
                // a status WASH for 2.4s on each new event, which turned the bell into a red plate —
                // a chrome button impersonating a status surface. The count badge below carries both
                // the severity and the arrival.
                className={cn(chromeAction, open && chromeActionActive)}
              >
                {activity.active > 0 ? (
                  <span
                    data-activity-ring=""
                    className="relative flex size-4 items-center justify-center"
                  >
                    <ContextRing
                      fraction={activity.fraction ?? 0.3}
                      size={16}
                      strokeWidth={2}
                      className={cn(
                        'absolute inset-0 text-composer-accent',
                        activity.fraction === null && 'animate-spin motion-reduce:animate-none',
                      )}
                    />
                    <Bell className="size-2.5 shrink-0" strokeWidth={2} />
                  </span>
                ) : (
                  <Bell className="size-3.5 shrink-0" strokeWidth={1.75} />
                )}
                {unread > 0 && unreadSeverity && (
                  <Chip
                    // Decorative: the button's own accessible name already reads "Event center,
                    // N unread", and the live region below announces changes. A counter that is
                    // also a live region announced a bare number on every arrival.
                    aria-hidden="true"
                    data-signal={signal ? '' : undefined}
                    tone="accent"
                    size="counter"
                    // Pinned inside the control's top-right corner (not overhanging it, where the
                    // window's rounded corner and the titlebar's top edge clipped the badge)
                    // rather than sitting beside the glyph in the flex row: inline, a two-digit
                    // count widened the button and shifted the whole titlebar cluster every time
                    // an event landed.
                    //
                    // The severity fill (solid status bg + contrast text) wins over the accent tone;
                    // counter's leading-4 drops to leading-none so the digits centre in the fixed-
                    // height pill. The 2px ring in the chrome ground cuts the badge away from the
                    // glyph it overlaps, which is what keeps a red dot on a bell readable.
                    className={cn(
                      'pointer-events-none absolute top-0.5 right-0 font-semibold leading-none ring-2 ring-sidebar',
                      'data-signal:animate-in data-signal:zoom-in-50 data-signal:duration-(--dur-moderate) motion-reduce:animate-none',
                      STATUS_BADGE_CLASS[unreadSeverity],
                    )}
                  >
                    {unread > 99 ? '99+' : unread}
                  </Chip>
                )}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{label}</TooltipContent>
        </Tooltip>

        {open && (
          <Suspense fallback={null}>
            <LazyNotificationCenterContent
              anchorRef={triggerRef}
              onRequestClose={() => setOpen(false)}
              focusEntryId={focusEntryId}
              activity={activity}
            />
          </Suspense>
        )}
      </Popover>
    </>
  )
}
