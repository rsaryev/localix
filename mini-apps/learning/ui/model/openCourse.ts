import { miniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime'

import { learningCourseUri } from '../../shared/resource-uri'

export const learningCourseTabId = (courseId: string) => `learning:course:${courseId}`

export function openLearningLibrary(sessionId: string): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'learning:workspace',
    id: 'learning:workspace',
    title: 'Learning Studio',
    scope: sessionId,
  })
}

/**
 * A course is stored inside the chat that owns it, so its tab opens in THAT chat. The session was
 * optional once, and a call without it left the host to place the tab in whichever chat was in
 * front — where the course does not exist. Every caller now names the owner.
 */
export function openLearningCourse(
  sessionId: string,
  courseId: string,
  title: string,
  resourceUri?: string,
): void {
  miniAppWorkspace.openWorkItem({
    workKind: 'learning:course',
    id: learningCourseTabId(courseId),
    title,
    scope: sessionId,
    payload: {
      courseId,
      resourceUri: resourceUri ?? learningCourseUri(courseId),
    },
  })
}
