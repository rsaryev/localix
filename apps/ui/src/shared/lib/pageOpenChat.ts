/**
 * The chat a PAGE-level intent acts on — "the chat that is open" — for the intents that arrive
 * from outside every chat surface: an OS deep link (`localix <file>`) and an OS file drop.
 *
 * The page that routes the open chat publishes it here after the grid switches workspace.
 * An OS deep link resolves a destination project and waits for its chat to be published;
 * opening it in the outgoing project's chat would hide the file after navigation. A drop
 * uses the currently open chat, or asks the person to open one when there is none.
 *
 * Read ONLY by such app-installed, page-level intents. Anything rendered inside a transcript or a
 * tab names its own session (`useWorkItemSessionId()`), never this.
 */
import { toast } from './notify'

let openChat: string | null = null
let openProject: string | null = null
const listeners = new Set<() => void>()

/** The page publishes the chat it shows; the returned cleanup withdraws it (page unmount). */
export function publishPageOpenChat(
  sessionId: string | null,
  projectId: string | null = null,
): () => void {
  openChat = sessionId
  openProject = projectId
  listeners.forEach((listener) => listener())
  return () => {
    if (openChat === sessionId && openProject === projectId) {
      openChat = null
      openProject = null
      listeners.forEach((listener) => listener())
    }
  }
}

/** OS file opens wait for the destination project's chat, never the outgoing chat. */
export function pageOpenChatInProject(projectId: string): string | null {
  return openProject === projectId ? openChat : null
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
