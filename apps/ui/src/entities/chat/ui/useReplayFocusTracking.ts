import { useEffect, type RefObject } from 'react'
import type { Virtualizer } from '@tanstack/react-virtual'
import { isToolBackedItem } from '@localixai/agent/agents/items'
import type { MessageDisplayRow } from '../model/messageGroups'
import { useMessageFocusStore } from '@/shared/lib/messageFocusBus'
import { createTrailingThrottle } from '@/shared/lib/throttle'

/**
 * Snapshot replay: while the inspector's Snapshot tab is open, track the topmost tool-bearing
 * message in view and point the tab at it. Gated on `active` so this listener costs nothing when
 * the tab isn't mounted.
 */
export function useReplayFocusTracking(
  scrollEl: HTMLDivElement | null,
  sessionId: string | null,
  virtualizer: Virtualizer<HTMLDivElement, HTMLDivElement>,
  rowsRef: RefObject<MessageDisplayRow[]>,
): void {
  const replayActive = useMessageFocusStore((s) => s.active)
  const setReplayFocus = useMessageFocusStore((s) => s.setFocus)
  useEffect(() => {
    if (!replayActive || !scrollEl || !sessionId) return
    const push = createTrailingThrottle((messageId: string) => {
      setReplayFocus(sessionId, messageId)
    }, 150)
    const onScroll = () => {
      // Pinned: the tab is frozen on a chosen message — don't chase the scroll.
      if (useMessageFocusStore.getState().pinned) return
      const top = scrollEl.scrollTop
      for (const vi of virtualizer.getVirtualItems()) {
        // Skip rows scrolled fully above the fold; first remaining row with tool
        // activity wins (so plain-text rows don't blank the panel).
        if (vi.start + vi.size <= top + 12) continue
        const m = rowsRef.current[vi.index]?.segments.find((segment) =>
          (segment.items ?? []).some(isToolBackedItem),
        )
        if (m) {
          push.call(m.id)
          break
        }
      }
    }
    onScroll()
    scrollEl.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scrollEl.removeEventListener('scroll', onScroll)
      push.cancel()
    }
  }, [replayActive, scrollEl, sessionId, virtualizer, setReplayFocus, rowsRef])
}
