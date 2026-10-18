import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { z } from 'zod'
import { zValidator } from '../../lib/validator'
import { choiceIdOf } from './catalog-source'
import type { SemanticService } from './service'

/**
 * `/rpc/semantic` — semantic search's settings surface: status (polled while Settings or an
 * index build is on screen), the two decisions the person owns (enable, which downloads what
 * is missing; remove the model), and the maintenance actions (pause, resume, rebuild, retry, prewarm).
 */
const modelBody = z.object({ modelId: z.string().min(3).max(300) })

export function createSemanticRoutes(service: SemanticService) {
  const app = new Hono<AppContext>()
  const routes = app
    .get('/status', async (c) => c.json(await service.status()))
    .post('/model', zValidator('json', modelBody), async (c) => {
      await service.setModel(choiceIdOf(c.req.valid('json').modelId), c.get('userId'))
      return c.json(await service.status())
    })
    .post('/enable', async (c) => {
      await service.enable()
      return c.json(await service.status())
    })
    .post('/disable', async (c) => {
      await service.disable()
      return c.json(await service.status())
    })
    .post('/pause', async (c) => {
      await service.pause()
      return c.json(await service.status())
    })
    .post('/resume', async (c) => {
      service.resume()
      return c.json(await service.status())
    })
    .post('/rebuild', async (c) => {
      await service.rebuild()
      return c.json(await service.status())
    })
    .post('/retry', async (c) => {
      await service.retry()
      return c.json(await service.status())
    })
    // Search opened: start the engine so the first query does not pay its start.
    .post('/prewarm', (c) => {
      service.prewarm()
      return c.json({ ok: true })
    })
    .delete('/model', async (c) => {
      await service.removeModel()
      return c.json(await service.status())
    })
  routes.onError(defaultErrorHandler)
  return routes
}
