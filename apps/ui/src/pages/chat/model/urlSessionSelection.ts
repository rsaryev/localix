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

/**
 * The routed project is CONFIRMED absent: the roster answered and does not hold it.
 *
 * localStorage outlives the database. A workspace window restored on a recreated
 * `~/.localix/localix.db` reopens its remembered `/project/PRJ-11/…` address while the new
 * database knows only `PRJ-1`; every request scoped to the dead id then fails. Before the
 * roster answers nothing is confirmed, so this stays false.
 */
export function isDeadRoutedProject(
  state: { projects: readonly { id: string }[]; projectsLoaded: boolean },
  routeProjectId: string | null | undefined,
): boolean {
  if (!routeProjectId || !state.projectsLoaded) return false
  return !state.projects.some((project) => project.id === routeProjectId)
}

/** A request refused because its project no longer exists — not retryable, not the person's. */
export function isMissingProjectError(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404 && error.code === 'project_not_found'
}
