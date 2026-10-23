/**
 * What the agent's `learning_course` tool changed, announced to this mini app's UI.
 *
 * The defect it stops: the tool records a review, moves the active lesson and activates a new or
 * re-warmed module on the server, and the open course and library learned of none of it except by
 * re-reading every 5 s — for as long as they were open, in a background window too. So the tool
 * says, once, that a chat's courses moved: on the mini app command bus (`session.emitCommand`), a
 * roster frame every chat's stream carries and a reconnect replays. The UI re-reads that chat's
 * courses. One value both sides import, so the names cannot drift apart.
 */
export const LEARNING_MINI_APP = 'learning'
export const LEARNING_CHANGES_CHANNEL = 'courses'

export interface CourseChange {
  courseId?: string
}

/** The payload as a {@link CourseChange}, or null — a frame from anywhere else is ignored. */
export function parseCourseChange(value: unknown): CourseChange | null {
  if (!value || typeof value !== 'object') return null
  const { courseId } = value as { courseId?: unknown }
  if (courseId === undefined) return {}
  return typeof courseId === 'string' && courseId !== '' ? { courseId } : null
}
