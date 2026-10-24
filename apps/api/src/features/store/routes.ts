import { Hono } from 'hono'
import {
  detailQuerySchema,
  discoverQuerySchema,
  discoverResponseSchema,
  enableRequestSchema,
  installPlanSchema,
  installRequestSchema,
  listingDetailSchema,
  listingParamsSchema,
  listingsQuerySchema,
  listingsResponseSchema,
  parseShelf,
  planRequestSchema,
  scopeRequestSchema,
  sourceAutoUpdateSchema,
  sourceInputSchema,
  sourcePreviewSchema,
  sourceRefSchema,
  sourceRemoveSchema,
  sourcesResponseSchema,
  storeActivitySchema,
  updatesApplyResponseSchema,
} from '@localixai/store'

import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import type { StoreService } from './service'

/**
 * `/rpc/store` (`docs/internals/store.md`, "Routes"): listings, a listing's page and plan, the
 * jobs that change an install, sources and activity, across every package kind. A provider's
 * domain error reaches the client with its own status and code through the one error handler
 * (A7). A write that queues a job answers 202, a switch 204: the `store` poke tells every surface
 * to read again (P11).
 */
export function createStoreRoutes(store: StoreService) {
  const app = new Hono<AppContext>()
  const actor = (c: { get(key: 'userId'): string }, projectId?: string) => ({
    userId: c.get('userId'),
    ...(projectId ? { projectId } : {}),
  })

  const routes = app
    .get('/listings', zValidator('query', listingsQuerySchema), async (c) => {
      const { shelf, installed, ...rest } = c.req.valid('query')
      const page = await store.listings(actor(c), {
        ...rest,
        ...(shelf ? { shelf: parseShelf(shelf)! } : {}),
        ...(installed ? { installed: installed === 'true' } : {}),
      })
      return c.json(listingsResponseSchema.parse(page), 200)
    })
    .get('/discover', zValidator('query', discoverQuerySchema), async (c) => {
      const { projectId } = c.req.valid('query')
      const answer = await store.discover(actor(c), projectId ? { projectId } : {})
      return c.json(discoverResponseSchema.parse(answer), 200)
    })
    .get('/activity', async (c) =>
      c.json(storeActivitySchema.parse(await store.activity(actor(c))), 200),
    )
    .post('/updates/apply', async (c) =>
      c.json(updatesApplyResponseSchema.parse({ queued: await store.applyUpdates(actor(c)) }), 202),
    )
    .get('/sources', async (c) => c.json(sourcesResponseSchema.parse(await store.sources()), 200))
    .post('/sources/preview', zValidator('json', sourceInputSchema), async (c) => {
      const { kind, input } = c.req.valid('json')
      return c.json(sourcePreviewSchema.parse(await store.previewSource(kind, input)), 200)
    })
    .post('/sources/add', zValidator('json', sourceInputSchema), async (c) => {
      const { kind, input } = c.req.valid('json')
      await store.addSource(kind, input)
      return c.body(null, 204)
    })
    .post('/sources/refresh', zValidator('json', sourceRefSchema), async (c) => {
      const { kind, id } = c.req.valid('json')
      await store.refreshSource(kind, id)
      return c.body(null, 204)
    })
    .post('/sources/auto-update', zValidator('json', sourceAutoUpdateSchema), async (c) => {
      const { kind, id, autoUpdate } = c.req.valid('json')
      await store.setSourceAutoUpdate(kind, id, autoUpdate)
      return c.body(null, 204)
    })
    .post('/sources/remove', zValidator('json', sourceRemoveSchema), async (c) => {
      const { kind, id } = c.req.valid('json')
      await store.removeSource(kind, id)
      return c.body(null, 204)
    })
    .get(
      '/:kind/:id',
      zValidator('param', listingParamsSchema),
      zValidator('query', detailQuerySchema),
      async (c) => {
        const { projectId } = c.req.valid('query')
        const detail = await store.detail(c.req.valid('param'), actor(c, projectId))
        return c.json(listingDetailSchema.parse(detail), 200)
      },
    )
    .post(
      '/:kind/:id/plan',
      zValidator('param', listingParamsSchema),
      zValidator('json', planRequestSchema),
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
      zValidator('json', scopeRequestSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('json')
        await store.update(c.req.valid('param'), scope, actor(c, projectId))
        return c.body(null, 202)
      },
    )
    .post(
      '/:kind/:id/remove',
      zValidator('param', listingParamsSchema),
      zValidator('json', scopeRequestSchema),
      async (c) => {
        const { scope, projectId } = c.req.valid('json')
        await store.remove(c.req.valid('param'), scope, actor(c, projectId))
        return c.body(null, 204)
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

  routes.onError(defaultErrorHandler)

  return routes
}
