import { randomUUID } from 'node:crypto'
import type { MiniAppWakeOutcome, MiniAppWakeRequest } from '@localixai/mini-app-sdk/backend'
import type { LearningCourse } from '../shared/contracts'
import type { LearningService } from './service'

type Wake = (request: MiniAppWakeRequest) => Promise<MiniAppWakeOutcome>
const QUEUED_TIMEOUT_MS = 15 * 60_000
const FAILED_RETRY_MS = 60_000

/** Prepare the next module halfway through this one, while the learner still has material. */
export function moduleToWarm(course: LearningCourse): string | null {
  const index = Math.max(
    0,
    course.modules.findIndex((module) =>
      module.lessons.some((lesson) => lesson.id === course.activeLessonId),
    ),
  )
  const current = course.modules[index]
  if (!current) return null
  if (current.lessons.some((lesson) => lesson.generationStatus === 'pending')) return current.id
  const completed = current.lessons.filter(
    (lesson) => course.progress[lesson.id]?.status === 'completed',
  ).length
  const atLast = current.lessons.at(-1)?.id === course.activeLessonId
  const next = course.modules[index + 1]
  return next?.lessons.some((lesson) => lesson.generationStatus === 'pending') &&
    (completed >= Math.ceil(current.lessons.length / 2) || atLast)
    ? next.id
    : null
}

export class ModuleGenerator {
  constructor(
    private readonly service: LearningService,
    private readonly wake?: Wake,
    private readonly now: () => number = Date.now,
  ) {}

  async warm(userId: string, sessionId: string, courseId: string): Promise<LearningCourse | null> {
    let request: MiniAppWakeRequest | null = null
    let moduleId: string | null = null
    const claimed = await this.service.change(userId, sessionId, courseId, (course) => {
      moduleId = moduleToWarm(course)
      if (!moduleId) return course
      const now = this.now()
      if (
        Object.values(course.generation ?? {}).some(
          (item) =>
            item.status === 'queued' && now - Date.parse(item.requestedAt) < QUEUED_TIMEOUT_MS,
        )
      )
        return course
      const previous = course.generation?.[moduleId]
      if (previous?.attempts && previous.attempts >= 3)
        return previous.status === 'failed'
          ? course
          : {
              ...course,
              generation: {
                ...course.generation,
                [moduleId]: {
                  ...previous,
                  status: 'failed',
                  reason: 'The module was not prepared after three requests.',
                },
              },
            }
      if (previous && now - Date.parse(previous.requestedAt) < FAILED_RETRY_MS) return course
      const requestId = randomUUID()
      const module = course.modules.find((item) => item.id === moduleId)!
      request = {
        userId,
        sessionId,
        tools: ['learning_course'],
        key: `module:${requestId}`,
        message: [
          `Warm the next Learning Studio module "${module.id}" (${module.title}) in course "${course.id}" in ${course.language}.`,
          `Call learning_course action guide for the exact bundle format and quality checklist, then action get with course_id "${course.id}" for learner evidence.`,
          `Canonical manifest: ${course.bundlePath}. Prepare ALL pending lessons in this module: ${module.lessons
            .filter((lesson) => lesson.generationStatus === 'pending')
            .map((lesson) => lesson.id)
            .join(', ')}.`,
          'Use ordinary file tools to edit only these lessons. Preserve stable ids, ready lessons, unrelated modules and progress. Read focused lessons only when needed; do not reload the whole course prose.',
          'Use earlier mistakes and practice reviews to tune examples. Research authoritative sources for changing facts; cite only sources actually read. If research fails, use another authoritative route or state what remains unverified.',
          'Each lesson needs a focused concept, worked example, diagnostic retrieval and a fresh practice with observable criteria. Read back, validate, then activate the same root course.json once the whole module is ready.',
          'This is preparation in the background. Do not ask intake questions again, do not complete lessons for the learner, and keep any final chat line brief.',
        ].join('\n'),
      }
      return {
        ...course,
        generation: {
          ...course.generation,
          [moduleId]: {
            requestId,
            status: 'queued',
            attempts: (previous?.attempts ?? 0) + 1,
            requestedAt: new Date(now).toISOString(),
          },
        },
      }
    })
    if (!request || !moduleId) return claimed
    let outcome: MiniAppWakeOutcome
    try {
      outcome = this.wake
        ? await this.wake(request)
        : { status: 'missed', reason: 'The tutor is unavailable in this host.' }
    } catch {
      outcome = { status: 'failed', reason: 'The tutor could not be reached.' }
    }
    if (outcome.status === 'delivered') return this.service.get(userId, sessionId, courseId)
    const failed = outcome
    const target = moduleId
    return this.service.change(userId, sessionId, courseId, (course) => {
      const state = course.generation?.[target]
      if (!state || state.requestId !== claimed?.generation?.[target]?.requestId) return course
      return {
        ...course,
        generation: {
          ...course.generation,
          [target]: { ...state, status: 'failed', reason: failed.reason },
        },
      }
    })
  }
}
