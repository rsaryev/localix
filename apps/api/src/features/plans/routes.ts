/**
 * The person's side of a plan, under `/rpc/sessions/:id/plans`: list the versions with the
 * draft's state, and decide on one — approve (with the mode to implement in and, optionally, the
 * agent or `all` who starts), request changes, dismiss, or reopen the latest one after it
 * was set aside.
 *
 * Every decision answers the conversation's full `plans` list — on success, and beside the error
 * of a 409 — and repeating a decision that already stands answers 200 (`service.ts`).
 *
 * `:id` is the ROOT session the plans belong to. Ownership is the service's: every read is
 * keyed by the caller's user id, so another user's plan answers 404 like one that never existed.
 */
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import { isPlanConflict } from './conflict'
import {
  approvePlanSchema,
  planParamsSchema,
  planSessionParamsSchema,
  requestPlanChangesSchema,
} from './contracts'
import type { PlanService } from './service'

export function createPlanRoutes(plans: PlanService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/sessions/:id/plans', zValidator('param', planSessionParamsSchema), async (c) => {
      const owner = { userId: c.get('userId'), sessionId: c.req.valid('param').id }
      return c.json(await plans.overview(owner), 200)
    })
    .post(
      '/sessions/:id/plans/:planId/approve',
      zValidator('param', planParamsSchema),
      zValidator('json', approvePlanSchema),
      async (c) => {
        const { id, planId } = c.req.valid('param')
        const owner = { userId: c.get('userId'), sessionId: id }
        const { mode } = c.req.valid('json')
        return c.json(await plans.approve(owner, planId, mode), 200)
      },
    )
    .post(
      '/sessions/:id/plans/:planId/request-changes',
      zValidator('param', planParamsSchema),
      zValidator('json', requestPlanChangesSchema),
      async (c) => {
        const { id, planId } = c.req.valid('param')
        const owner = { userId: c.get('userId'), sessionId: id }
        const note = c.req.valid('json').note || undefined
        return c.json(await plans.requestChanges(owner, planId, note), 200)
      },
    )
    .post(
      '/sessions/:id/plans/:planId/dismiss',
      zValidator('param', planParamsSchema),
      async (c) => {
        const { id, planId } = c.req.valid('param')
        const owner = { userId: c.get('userId'), sessionId: id }
        return c.json(await plans.dismiss(owner, planId), 200)
      },
    )
    .post(
      '/sessions/:id/plans/:planId/reopen',
      zValidator('param', planParamsSchema),
      async (c) => {
        const { id, planId } = c.req.valid('param')
        const owner = { userId: c.get('userId'), sessionId: id }
        return c.json(await plans.reopen(owner, planId), 200)
      },
    )

  // A decision on a version decided meanwhile answers the versions as they are beside the error
  // (`conflict.ts`), so the client corrects its list instead of showing a stale Approve again.
  routes.onError((error, c) =>
    isPlanConflict(error)
      ? c.json({ error: { code: error.code, message: error.message }, plans: error.plans }, 409)
      : defaultErrorHandler(error, c),
  )
  return routes
}
