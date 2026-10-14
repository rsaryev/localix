import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { defaultErrorHandler } from '../../lib/http'
import { searchRequestSchema } from './contracts'
import type { SearchService } from './service'

/**
 * Global search — ONE endpoint fanning a text query out across every registered
 * domain provider (chat, db, containers, files, plugins, …). The
 * service ranks + groups + paginates; providers are best-effort (a failing one is
 * swallowed to []), so this endpoint effectively never errors on a missing daemon or
 * unreachable cluster. `userId` comes from the app-wide middleware (`c.get('userId')`).
 */
export function createSearchRoutes(service: SearchService) {
  const app = new Hono<AppContext>()

  const routes = app.post('/', zValidator('json', searchRequestSchema), async (c) => {
    return c.json(await service.search(c.get('userId'), c.req.valid('json')))
  })

  routes.onError(defaultErrorHandler)
  return routes
}
