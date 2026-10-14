import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { Bell } from 'lucide-react'
import { cn } from '@localixai/plugin-sdk/ui/classes'

import { subscribeNotificationCenter } from '@/shared/lib/notificationCenterBus'
import { eventSignalKey, highestUnreadSeverity } from '@/shared/lib/notifications/signal'
import { selectUnreadCount, useNotificationsStore } from '@/shared/lib/notifications/store'
import { subscribeUiOverlay } from '@/shared/lib/uiOverlayBus'
import { Popover, PopoverTrigger } from '@localixai/kit/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@localixai/kit/tooltip'
import { chromeAction, chromeActionActive } from '@localixai/kit/chrome-action'
import { Chip } from '@localixai/kit/chip'
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

/** Always-present event signal; the detailed journal is instantiated on demand. */
export function NotificationCenterLauncher() {
  const [open, setOpen] = useState(false)
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
  const label = unread > 0 ? `Event Center, ${unread} unread` : 'Event Center'

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
                <Bell className="size-3.5 shrink-0" strokeWidth={1.75} />
                {unread > 0 && unreadSeverity && (
                  <Chip
                    // Decorative: the button's own accessible name already reads "Event center,
                    // N unread", and the live region below announces changes. A counter that is
                    // also a live region announced a bare number on every arrival.
                    aria-hidden="true"
                    data-signal={signal ? '' : undefined}
                    tone="accent"
                    size="counter"
                    // Pinned to the control's top-right corner rather than sitting beside the glyph
                    // in the flex row: inline, a two-digit count widened the button and shifted the
                    // whole titlebar cluster every time an event landed.
                    //
                    // The severity fill (solid status bg + contrast text) wins over the accent tone;
                    // counter's leading-4 drops to leading-none so the digits centre in the fixed-
                    // height pill. The 2px ring in the chrome ground cuts the badge away from the
                    // glyph it overlaps, which is what keeps a red dot on a bell readable.
                    className={cn(
                      'pointer-events-none absolute -top-px -right-px font-semibold leading-none ring-2 ring-sidebar',
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
            />
          </Suspense>
        )}
      </Popover>
    </>
  )
}
