/**
 * "Continue" under `/rpc/sessions/:id/resume`: the ROOT conversation's unfinished work, and
 * continuing one piece of it by its key.
 *
 * Ownership is the producers': each reads by the caller's user id, so another user's session
 * lists nothing and continuing in it answers the 409 of a point that does not hold.
 */
import { Hono } from 'hono'
import { z } from 'zod'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import { isResumeConflict, type ResumeRegistry } from './registry'

const sessionParamsSchema = z.object({ id: z.string().min(1) })
const resumeSchema = z.object({ key: z.string().min(1) })

export function createResumeRoutes(resume: ResumeRegistry) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/sessions/:id/resume', zValidator('param', sessionParamsSchema), async (c) => {
      const owner = { userId: c.get('userId'), sessionId: c.req.valid('param').id }
      return c.json({ points: await resume.list(owner) }, 200)
    })
    .post(
      '/sessions/:id/resume',
      zValidator('param', sessionParamsSchema),
      zValidator('json', resumeSchema),
      async (c) => {
        const owner = { userId: c.get('userId'), sessionId: c.req.valid('param').id }
        return c.json(await resume.resume(owner, c.req.valid('json').key), 200)
      },
    )

  // A point that no longer holds answers the current list beside the error, so the client drops
  // the Continue it was showing instead of offering it again.
  routes.onError((error, c) =>
    isResumeConflict(error)
      ? c.json({ error: { code: error.code, message: error.message }, points: error.points }, 409)
      : defaultErrorHandler(error, c),
  )
  return routes
}
