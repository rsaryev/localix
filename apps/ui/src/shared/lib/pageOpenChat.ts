/**
 * The chat a PAGE-level intent acts on — "the chat that is open" — for the intents that arrive
 * from outside every chat surface: an OS deep link (`localix <file>`) and an OS file drop.
 *
 * The page that routes the open chat publishes it here after the grid switches workspace. An OS
 * file open and a drop both land in the chat on screen, exactly as a drop always has: neither may
 * switch the person to another project or create one. A cold launch waits for the first chat to be
 * published; a drop asks the person to open one when there is none.
 *
 * Read ONLY by such app-installed, page-level intents. Anything rendered inside a transcript or a
 * tab names its own session (`useWorkItemSessionId()`), never this.
 */
import { toast } from './notify'

let openChat: string | null = null
const listeners = new Set<() => void>()

/** The page publishes the chat it shows; the returned cleanup withdraws it (page unmount). */
export function publishPageOpenChat(sessionId: string | null): () => void {
  openChat = sessionId
  listeners.forEach((listener) => listener())
  return () => {
    if (openChat === sessionId) {
      openChat = null
      listeners.forEach((listener) => listener())
    }
  }
}

/** The chat on screen, whatever its project — `null` while none is (a cold launch). Silent. */
export function pageOpenChatCurrent(): string | null {
  return openChat
}

export function subscribePageOpenChat(listener: () => void): () => void {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/**
 * The chat a page-level command was given — or `null` after telling the person to open one, so
 * the caller opens nothing. For commands that hold the open chat explicitly (a shortcut, the app
 * menu, a palette opened from the page) as well as for the app-installed intents below.
 */
export function requireOpenChat(sessionId: string | null): string | null {
  if (!sessionId) toast.info('Open a conversation first')
  return sessionId
}

/** The open chat the page published — or `null` after telling the person to open one. */
export function pageOpenChatOrNotify(): string | null {
  return requireOpenChat(openChat)
}
