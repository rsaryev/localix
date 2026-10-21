import { useEffect } from 'react'

import { setDesktopBadge } from '@/shared/lib/desktopBadge'
import { useNotificationPrefs } from '@/shared/lib/notifications/prefs'
import { dockAttentionCount } from './attention/select'
import { useAttentionStore } from './attention/store'

/**
 * THE ONLY WRITER OF THE DOCK / TASKBAR BADGE.
 *
 * There used to be two: this hook pushed the count of background conversations waiting on the
 * person through the shell's `set_badge` command, and the Event Center pushed its unread count
 * through the window badge API. Both wrote the same native badge, so it showed whichever had
 * changed last — "3" meant waiting conversations one moment and unread history the next.
 *
 * The badge now means one thing: how many conversations are waiting on the person, by the shared
 * attention roster (`dockAttentionCount` — each kind's `countsOnDock` decides whether it counts).
 * The Event Center keeps its own unread count on the bell. The "app icon badge" preference gates
 * it, so turning it off clears the badge. `setDesktopBadge` dedupes and is a no-op outside the
 * desktop shell.
 */
export function dockBadgeCount(count: number, enabled: boolean): number {
  return enabled ? count : 0
}

export function useDockBadge(): void {
  const count = useAttentionStore((state) => dockAttentionCount(state.items))
  const enabled = useNotificationPrefs((state) => state.appIconBadge)
  useEffect(() => {
    setDesktopBadge(dockBadgeCount(count, enabled))
  }, [count, enabled])
}
