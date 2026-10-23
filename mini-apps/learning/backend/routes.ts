import { Hono } from 'hono'
import { z } from 'zod'
import { routeValidator } from '@localixai/mini-app-sdk/backend'
import type { MiniAppRouteContext } from '@localixai/mini-app-sdk/backend'

import {
  MAX_PORTABLE_COURSE_BYTES,
  PORTABLE_COURSE_EXTENSION,
  PORTABLE_COURSE_MIME,
} from './course-portable'
import type { LearningService } from './service'
import type { LearningTutor } from './tutor'

const courseId = z.string().trim().min(1).max(120)
const sessionId = z.string().trim().min(1).max(200)
const sessionQuery = z.object({ sessionId })
const courseQuery = z.object({ sessionId, courseId })
const activeBody = z.object({
  sessionId,
  courseId,
  lessonId: z.string().trim().min(1).max(120),
  stepId: z.string().trim().min(1).max(120).optional(),
})
const progressBody = z.object({
  sessionId,
  courseId,
  lessonId: z.string().trim().min(1).max(120),
  status: z.enum(['not-started', 'in-progress', 'completed']),
  score: z.number().min(0).max(100).optional(),
  confidence: z.number().int().min(1).max(5).optional(),
})
const stepBody = z.object({
  sessionId,
  courseId,
  lessonId: z.string().trim().min(1).max(120),
  stepId: z.string().trim().min(1).max(120),
  optionId: z.string().trim().min(1).max(120).optional(),
  recalled: z.boolean().optional(),
})
const practiceBody = stepBody.extend({ response: z.string().trim().min(1).max(20_000) })

/**
 * The SDK's validator in its `text` envelope — `{ error: '<sentence>' }`: the UI throws
 * `json.error` as an Error message, and the summary OBJECT this router once sent there rendered as
 * "[object Object]".
 */
const validated = routeValidator({ envelope: 'text' })

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The sentence, and the raw text under it.
 *
 * What this service throws is written to be read; what `JSON.parse` and the filesystem throw is
 * not. A wrapped throw keeps that text as its `cause`, and `detail` is where it belongs — the
 * Event Center renders it, a problem line across the studio does not.
 */
function failure(error: unknown): { error: string; detail?: string } {
  const said = message(error)
  const raw = error instanceof Error && error.cause instanceof Error ? error.cause.message : ''
  return { error: said, ...(raw && raw !== said ? { detail: raw } : {}) }
}

export function createLearningRoutes(service: LearningService, tutor?: LearningTutor) {
  const warm = async (
    userId: string,
    session: string,
    course: Awaited<ReturnType<LearningService['get']>>,
  ) => (course && tutor ? await tutor.warm(userId, session, course.id) : course)
  return new Hono<MiniAppRouteContext>()
    .get('/courses', validated('query', sessionQuery), async (c) => {
      try {
        return c.json({ courses: await service.list(c.env.userId, c.req.valid('query').sessionId) })
      } catch (error) {
        return c.json(failure(error), 500)
      }
    })
    .get('/course', validated('query', courseQuery), async (c) => {
      try {
        return c.json({
          course: await warm(
            c.env.userId,
            c.req.valid('query').sessionId,
            await service.get(
              c.env.userId,
              c.req.valid('query').sessionId,
              c.req.valid('query').courseId,
            ),
          ),
        })
      } catch (error) {
        return c.json(failure(error), 500)
      }
    })
    .get('/course/export', validated('query', courseQuery), async (c) => {
      try {
        const { sessionId: session, courseId: scope } = c.req.valid('query')
        const serialized = await service.exportPortable(c.env.userId, session, scope)
        if (!serialized) return c.json({ error: 'Course not found' }, 404)
        const safeName = scope.replaceAll(/[^a-zA-Z0-9._-]/g, '-')
        return c.body(serialized, 200, {
          'Content-Type': `${PORTABLE_COURSE_MIME}; charset=utf-8`,
          'Content-Disposition': `attachment; filename="${safeName}${PORTABLE_COURSE_EXTENSION}"`,
          'Cache-Control': 'no-store',
        })
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
    .post('/course/import', validated('query', sessionQuery), async (c) => {
      try {
        const declaredBytes = Number(c.req.header('content-length') ?? 0)
        if (declaredBytes > MAX_PORTABLE_COURSE_BYTES) {
          return c.json({ error: 'The selected course file is too large.' }, 413)
        }
        const serialized = await c.req.text()
        if (Buffer.byteLength(serialized, 'utf8') > MAX_PORTABLE_COURSE_BYTES) {
          return c.json({ error: 'The selected course file is too large.' }, 413)
        }
        const course = await service.importPortable(
          c.env.userId,
          c.req.valid('query').sessionId,
          serialized,
        )
        return c.json({ course })
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
    .post('/course/active', validated('json', activeBody), async (c) => {
      try {
        const { sessionId: session, courseId: scope, lessonId, stepId } = c.req.valid('json')
        const course = await warm(
          c.env.userId,
          session,
          await service.setActive(c.env.userId, session, scope, lessonId, stepId),
        )
        return course ? c.json({ course }) : c.json({ error: 'Course not found' }, 404)
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
    .post('/course/progress', validated('json', progressBody), async (c) => {
      try {
        const { sessionId: session, courseId: scope, ...update } = c.req.valid('json')
        const course = await warm(
          c.env.userId,
          session,
          await service.updateProgress(c.env.userId, session, scope, update),
        )
        return course ? c.json({ course }) : c.json({ error: 'Course not found' }, 404)
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
    .post('/course/step', validated('json', stepBody), async (c) => {
      try {
        const {
          sessionId: session,
          courseId: scope,
          lessonId,
          stepId,
          ...evidence
        } = c.req.valid('json')
        const course = await warm(
          c.env.userId,
          session,
          await service.completeStep(c.env.userId, session, scope, lessonId, stepId, evidence),
        )
        return course ? c.json({ course }) : c.json({ error: 'Course not found' }, 404)
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
    .post('/course/practice', validated('json', practiceBody), async (c) => {
      try {
        if (!tutor) return c.json({ error: 'The tutor is unavailable.' }, 503)
        const {
          sessionId: session,
          courseId: scope,
          lessonId,
          stepId,
          response,
        } = c.req.valid('json')
        const course = await tutor.submit(c.env.userId, session, scope, lessonId, stepId, response)
        return course ? c.json({ course }) : c.json({ error: 'Course not found' }, 404)
      } catch (error) {
        return c.json(failure(error), 400)
      }
    })
}
