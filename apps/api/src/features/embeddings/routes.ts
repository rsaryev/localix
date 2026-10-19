import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import type { SemanticService } from './service'

/**
 * `/rpc/semantic` — semantic search's surface: status (polled while Settings or an index build
 * is on screen) and the maintenance actions (pause, resume, rebuild, retry, prewarm). It is
 * always on, with one model: there is nothing to switch or choose.
 */

export function createSemanticRoutes(service: SemanticService) {
  const app = new Hono<AppContext>()
  const routes = app
    .get('/status', async (c) => c.json(await service.status()))
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
  routes.onError(defaultErrorHandler)
  return routes
}
