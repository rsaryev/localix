import type { NotificationEntry } from './types'
import { originSession } from './origin'

/** Where a notification row navigates when clicked (a chat + its project scope). */
export interface NotificationNavTarget {
  sessionId: string
  /** The project scope for the chat URL; `null` = the project-less Global scope. */
  projectId: string | null
}

/**
 * Pure: source navigation is available only when the event explicitly carries
 * a session-bearing origin. Trace display text is intentionally never consulted.
 */
export function notificationNavTarget(entry: NotificationEntry): NotificationNavTarget | null {
  return originSession(entry.origin)
}
