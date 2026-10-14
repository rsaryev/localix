import { create } from 'zustand'

/**
 * Tiny seam between the in-conversation search bar and the virtualized message
 * list: the bar writes the id of the message it wants brought into view, the
 * `MessageList` scrolls to it, and each `MessageCard` rings itself when it's the
 * active match (subscribing to its OWN match status, so only the two affected
 * cards re-render on navigation). `null` = search closed / no active match.
 */
interface MessageSearchState {
  /** Whether the find bar is open — lifted here so a header button (and the
   *  keyboard shortcut) can both open it, incl. on touch where there's no ⌘F. */
  open: boolean
  activeId: string | null
  /** A query the cross-conversation "Found in messages" results stash so that
   *  opening the chosen chat ALSO opens its in-chat find with the same query
   *  (consume-once, matched by session). */
  pending: { sessionId: string; query: string } | null
  setOpen: (open: boolean) => void
  setActiveId: (id: string | null) => void
  requestSearch: (sessionId: string, query: string) => void
  /** Pop the pending query iff it's for `sessionId` (clears it either way). */
  takePending: (sessionId: string) => string | null
}

export const useMessageSearchStore = create<MessageSearchState>((set, get) => ({
  open: false,
  activeId: null,
  pending: null,
  // Closing also drops the active match so the ring clears.
  setOpen: (open) => set(open ? { open: true } : { open: false, activeId: null }),
  setActiveId: (activeId) => set({ activeId }),
  requestSearch: (sessionId, query) => set({ pending: { sessionId, query } }),
  takePending: (sessionId) => {
    const p = get().pending
    if (!p) return null
    set({ pending: null }) // consume-once: the first switch claims (or discards) it
    return p.sessionId === sessionId ? p.query : null
  },
}))
