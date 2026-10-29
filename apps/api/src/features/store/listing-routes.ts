import { Hono } from 'hono'
import {
  actionRequestSchema,
  actionResultSchema,
  autoUpdateRequestSchema,
  enableRequestSchema,
  installPlanSchema,
  installRequestSchema,
  listingConfigSchema,
  listingDetailSchema,
  listingParamsSchema,
  projectQuerySchema,
  scopedSchema,
  scopedValuesSchema,
} from '@localixai/store'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import type { StoreService } from './service'

/** Who asks: the signed-in person, and the open project a `project` scope means. */
export const storeActor = (c: { get(key: 'userId'): string }, projectId?: string) => ({
  userId: c.get('userId'),
  ...(projectId ? { projectId } : {}),
})

/**
 * `/rpc/store/:kind/:id`: one package's page and plan, and the jobs and switches that change its
 * install (`docs/internals/store.md`, "Routes"). A write that queues a job answers 202, a switch
 * 204; the `store` poke tells every surface to read again (P11).
 */
export function createListingRoutes(store: StoreService) {
  const actor = storeActor
  const routes = new Hono<AppContext>()
    .get(
      '/:kind/:id',
      zValidator('param', listingParamsSchema),
      zValidator('query', projectQuerySchema),
      async (c) => {
        const { projectId } = c.req.valid('query')
        const detail = await store.detail(c.req.valid('param'), actor(c, projectId))
        return c.json(listingDetailSchema.parse(detail), 200)
      },
    )
    .post(
      '/:kind/:id/plan',
      zValidator('param', listingParamsSchema),
      zValidator('json', scopedSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('json')
        const plan = await store.plan(c.req.valid('param'), scope, actor(c, projectId))
        return c.json(installPlanSchema.parse(plan), 200)
      },
    )
    .post(
      '/:kind/:id/install',
      zValidator('param', listingParamsSchema),
      zValidator('json', installRequestSchema),
      async (c) => {
        const { scope, consent, projectId } = c.req.valid('json')
        await store.install(c.req.valid('param'), scope, consent, actor(c, projectId))
        return c.body(null, 202)
      },
    )
    .post(
      '/:kind/:id/update',
      zValidator('param', listingParamsSchema),
      zValidator('json', scopedSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('json')
        await store.update(c.req.valid('param'), scope, actor(c, projectId))
        return c.body(null, 202)
      },
    )
    .post(
      '/:kind/:id/remove',
      zValidator('param', listingParamsSchema),
      zValidator('json', scopedSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('json')
        await store.remove(c.req.valid('param'), scope, actor(c, projectId))
        return c.body(null, 204)
      },
    )
    .get(
      '/:kind/:id/config',
      zValidator('param', listingParamsSchema),
      zValidator('query', scopedSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('query')
        const config = await store.config(c.req.valid('param'), scope, actor(c, projectId))
        return c.json(listingConfigSchema.parse(config), 200)
      },
    )
    .post(
      '/:kind/:id/config',
      zValidator('param', listingParamsSchema),
      zValidator('json', scopedValuesSchema),
      async (c) => {
        const { scope, values, projectId } = c.req.valid('json')
        await store.setConfig(c.req.valid('param'), scope, values, actor(c, projectId))
        return c.body(null, 204)
      },
    )
    .post(
      '/:kind/:id/action',
      zValidator('param', listingParamsSchema),
      zValidator('json', actionRequestSchema),
      async (c) => {
        const { scope, action, projectId } = c.req.valid('json')
        const result = await store.runAction(
          c.req.valid('param'),
          scope,
          action,
          actor(c, projectId),
        )
        return c.json(actionResultSchema.parse(result), 200)
      },
    )
    .post(
      '/:kind/:id/enable',
      zValidator('param', listingParamsSchema),
      zValidator('json', enableRequestSchema),
      async (c) => {
        const { scope, enabled, projectId } = c.req.valid('json')
        await store.setEnabled(c.req.valid('param'), scope, enabled, actor(c, projectId))
        return c.body(null, 204)
      },
    )
    .post(
      '/:kind/:id/auto-update',
      zValidator('param', listingParamsSchema),
      zValidator('json', autoUpdateRequestSchema),
      async (c) => {
        await store.setAutoUpdate(c.req.valid('param'), c.req.valid('json').autoUpdate, actor(c))
        return c.body(null, 204)
      },
    )

  routes.onError(defaultErrorHandler)

  return routes
}
