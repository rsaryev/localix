import type { UiSession } from '@/shared/api/contracts'
import { ApiError } from '@/shared/api/internal'
import { findSessionInState } from '@/features/chat/model/findSession'

type SessionSelectionState = {
  activeSessionId: string | null
  sessions: UiSession[]
  allSessions: UiSession[]
}

/**
 * A matching active id is not enough to skip selection: workspace hydration
 * activates summaries before their transcript body has been fetched.
 */
export function shouldLoadRoutedSession(
  state: SessionSelectionState,
  routeSessionId: string,
): boolean {
  if (state.activeSessionId !== routeSessionId) return true
  const session = findSessionInState(state, routeSessionId)
  return !session || session.bodyLoaded === false
}

/** A stale/deleted deep link cannot become loadable through transport retries. */
export function isMissingRoutedSessionError(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 410)
}
