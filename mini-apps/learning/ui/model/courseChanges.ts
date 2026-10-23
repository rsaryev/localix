/**
 * Where the agent's course changes reach the open course and the library — `shared/course-changes.ts`
 * says why this is a push rather than a poll. A change invalidates that chat's courses on
 * `LEARNING_COURSES`, the topic the UI's own writes already announce on, so every reader re-reads
 * the same way whoever moved the course. Every chat's frames count: a course belongs to its chat,
 * and an agent tutoring in a background chat still moves the course open in another window.
 */
import { miniAppCommandBus, type MiniAppCommandEvent } from '@localixai/mini-app-sdk/ui/commands'
import { useResourceTopic } from '@localixai/mini-app-sdk/ui/shared-resource'
import { useStoreChanges } from '@localixai/mini-app-sdk/ui/store-resource'
import { useVisiblePolling } from '@localixai/mini-app-sdk/ui/visibility'
import {
  LEARNING_CHANGES_CHANNEL,
  LEARNING_MINI_APP,
  parseCourseChange,
} from '../../shared/course-changes'
import { LEARNING_COURSES } from './topics'

export function applyCourseChange(event: Pick<MiniAppCommandEvent, 'sessionId' | 'payload'>) {
  if (parseCourseChange(event.payload)) LEARNING_COURSES.invalidate(event.sessionId)
}

let registered = false

/** Once per page: the command bus keeps its sinks for the life of the app. */
export function initCourseChanges(): void {
  if (registered) return
  registered = true
  miniAppCommandBus.register(LEARNING_MINI_APP, LEARNING_CHANGES_CHANNEL, applyCourseChange)
}

/**
 * While a course or the library is shown, how often it still re-reads: the backstop for a change
 * no frame announced (another window's own write), not how the agent's change arrives.
 */
export const COURSE_BACKSTOP_MS = 60_000

/**
 * Re-read one chat's courses when they change, for a course tab and the library alike.
 *
 * Both re-read on a raw 5 s `setInterval` gated only by the tab's own flag, so a course left open
 * in a background window re-read forever, to catch the agent's changes. The agent's change now
 * arrives on `LEARNING_COURSES` (it costs one read, so it is heard even while hidden and the tab
 * shows the truth when it is next shown); the backstop is the SDK's visibility-gated, non-
 * overlapping poll, which stops in a hidden window.
 */
export function useCourseChanges(
  sessionId: string,
  visible: boolean,
  refresh: () => Promise<unknown>,
): void {
  const live = useStoreChanges(
    { miniApp: 'learning', sessionId },
    () => LEARNING_COURSES.invalidate(sessionId),
    visible,
  )
  useResourceTopic(LEARNING_COURSES, () => void refresh(), sessionId)
  useVisiblePolling({ enabled: visible && !live, intervalMs: COURSE_BACKSTOP_MS, onTick: refresh })
}
