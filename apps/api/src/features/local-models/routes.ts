import { Hono } from 'hono'
import { z } from 'zod'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import type { LocalModelsService } from './service'

const modelBody = z.object({ modelId: z.string().min(3).max(300) })
const catalogQuery = z.object({
  /** A Hugging Face model id to add; absent, the curated list. */
  id: z.string().max(200).optional(),
  kind: z.enum(['chat', 'embedding']).optional(),
})

/**
 * `/rpc/local-models` — models on this computer: what is installed and running (polled while a
 * download or the settings tab is on screen), the catalog (or a model added by its id), and the
 * person's actions:
 * download, pause (resumed by downloading again), cancel (deletes what was fetched), remove.
 * Model ids carry `/` and `:`, so they travel in bodies, not paths.
 */
export function createLocalModelsRoutes(service: LocalModelsService) {
  const app = new Hono<AppContext>()
  const routes = app
    .get('/status', async (c) => c.json(await service.status()))
    .get('/catalog', zValidator('query', catalogQuery), async (c) => {
      const { id, kind } = c.req.valid('query')
      return c.json({
        models: await service.catalog.list({
          ...(id ? { id } : {}),
          ...(kind ? { kind } : {}),
        }),
      })
    })
    // What to get first, sized for this computer: Gemma 4 and the embedding model.
    .get('/recommended', async (c) => c.json({ models: await service.catalog.recommended() }))
    // One model with its exact files and hashes, planned for this computer (the details panel).
    .get('/model', zValidator('query', z.object({ id: z.string().min(3).max(300) })), async (c) =>
      c.json({ model: await service.catalog.details(c.req.valid('query').id) }),
    )
    .post('/install', zValidator('json', modelBody), async (c) => {
      const job = await service.install(c.req.valid('json').modelId)
      return c.json({ job })
    })
    .post('/pause', zValidator('json', modelBody), async (c) => {
      await service.pause(c.req.valid('json').modelId)
      return c.json(await service.status())
    })
    .post('/cancel', zValidator('json', modelBody), async (c) => {
      await service.cancel(c.req.valid('json').modelId)
      return c.json(await service.status())
    })
    .post('/remove', zValidator('json', modelBody), async (c) => {
      await service.remove(c.req.valid('json').modelId)
      return c.json(await service.status())
    })
  routes.onError(defaultErrorHandler)
  return routes
}
