import { isOriginOnScreen, onActiveEventRoute } from './context'
import { useNotificationsStore } from './store'

/**
 * OPENING A CHAT IS SEEING ITS EVENTS.
 *
 * A row was marked read only when it arrived live while its chat was on screen. Everything else
 * about that chat — a finished run from last night, a question the agent asked while the
 * window was closed — stayed an unread badge even while the person sat in the conversation it was
 * about, reading it. So whenever the chat on screen has unread rows, they are read: on arriving
 * at the chat, and when rows for it land later (the first sync after a launch lands after the
 * route). Read is not resolved: a pending question keeps its "Needs action" until it is answered.
 */
export function startOpenChatRead(): () => void {
  const markOpenChatRead = () => {
    const { entries, markRead } = useNotificationsStore.getState()
    for (const entry of entries) {
      if (!entry.read && isOriginOnScreen(entry.origin)) markRead(entry.id)
    }
  }
  const offRoute = onActiveEventRoute(markOpenChatRead)
  const offEntries = useNotificationsStore.subscribe((state, previous) => {
    if (state.entries !== previous.entries) markOpenChatRead()
  })
  markOpenChatRead()
  return () => {
    offRoute()
    offEntries()
  }
}
