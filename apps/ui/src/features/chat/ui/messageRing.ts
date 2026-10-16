import { useMessageSearchStore } from '@/shared/lib/messageSearchBus'

/** How long a pill click keeps the target card's search ring lit. */
export const MESSAGE_RING_MS = 1600

/**
 * Light the message-search ring on `messageId` (the transcript scrolls to it through the search
 * seam), then clear it unless the user has since opened search or the ring moved on.
 */
export function ringMessage(messageId: string): void {
  useMessageSearchStore.getState().setActiveId(messageId)
  setTimeout(() => {
    const cur = useMessageSearchStore.getState()
    if (cur.activeId === messageId && !cur.open) cur.setActiveId(null)
  }, MESSAGE_RING_MS)
}
