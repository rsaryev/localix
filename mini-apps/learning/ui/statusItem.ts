import { GraduationCap } from 'lucide-react'
import type { StatusItemState } from '@localixai/mini-app-sdk/ui'
import { statusMenuList } from '@localixai/mini-app-sdk/ui'
import { createSharedResource } from '@localixai/mini-app-sdk/ui/shared-resource'
import { useMiniAppWorkspace } from '@localixai/mini-app-sdk/ui/runtime-hooks'

import type { CourseSummary } from '../shared/contracts'
import { learningApi } from './api/learningApi'
import { LEARNING_COURSES } from './model/topics'
import { openLearningCourse, openLearningLibrary } from './model/openCourse'

const WORKSPACE_KIND = 'learning:workspace'
const COURSE_KIND = 'learning:course'

/** Keyed by SESSION: a course is stored and resolved inside the chat that owns it. */
// Every write goes through `learningApi`, and every write invalidates the session it touched. So
// a completed step moves the titlebar without this ever asking a second time on its own.
const courses = createSharedResource<CourseSummary[]>((sessionId) => learningApi.list(sessionId), {
  topic: LEARNING_COURSES,
})

/** `n/m`, or nothing when a course has no lessons to count. */
function progressOf(course: CourseSummary): string | null {
  return course.totalLessons > 0 ? `${course.completedLessons}/${course.totalLessons}` : null
}

/**
 * How far through a course this session is.
 *
 * A progress fraction is the rare number that is BOTH live and slow: it moves only when a person
 * finishes something, which is exactly the rhythm chrome should reflect. And it is the number a
 * study surface is worst at showing you — it lives inside the course tab, which is the one place
 * you cannot see while doing anything else.
 *
 * No courses in this session, no control. The mini app is silent for every chat that is not
 * studying.
 */
export function useLearningStatusItem(sessionId: string | null): StatusItemState | null {
  const workspace = useMiniAppWorkspace()
  const list = courses.use(sessionId)

  const focusedId = workspace.focusedId
  const focusedKind = focusedId ? workspace.items[focusedId]?.kind : undefined
  const active = focusedKind === WORKSPACE_KIND || focusedKind === COURSE_KIND

  if (!sessionId || !list || list.length === 0) return null

  // Most recently touched first — the course you are actually in.
  const ordered = [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const current = ordered[0]!
  const progress = progressOf(current)

  const done = current.totalLessons > 0 && current.completedLessons >= current.totalLessons

  return {
    label: progress
      ? `Learning Studio — ${current.title}, ${progress} lessons done`
      : `Learning Studio — ${current.title}`,
    Icon: GraduationCap,
    text: current.title,
    ...(progress
      ? {
          metrics: [
            {
              value: progress,
              label: `${current.completedLessons} of ${current.totalLessons} lessons complete`,
              ...(done ? { tone: 'success' as const } : {}),
            },
          ],
        }
      : {}),
    active,
    onClick: () => openLearningCourse(sessionId, current.id, current.title),
    menu: [
      {
        id: 'library',
        label: 'Open Learning Studio',
        icon: GraduationCap,
        onSelect: () => openLearningLibrary(sessionId),
      },
      { separator: true },
      ...statusMenuList({
        header: 'Resume a course',
        items: ordered,
        row: (course) => ({
          id: `course:${course.id}`,
          label: course.title,
          // `Title · 3/12` was one string the eye had to split. As a hint the fractions line up in
          // a column, so several courses can be compared at a glance.
          ...(progressOf(course) ? { hint: progressOf(course)! } : {}),
          selected: course.id === current.id,
          onSelect: () => openLearningCourse(sessionId, course.id, course.title),
        }),
        onOverflow: () => openLearningLibrary(sessionId),
        overflowLabel: (hidden) => `${hidden} more courses…`,
      }),
    ],
  }
}
