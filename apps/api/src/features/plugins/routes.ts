import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import { defaultErrorHandler } from '../../lib/http'
import { listOutputStylesResponseSchema } from './output-style-listing'
import type { AppContext } from '../../app'
import { listMarketplacesResponseSchema } from './contracts'
import type { PluginService } from './service-types'

/**
 * The plugin reads the composer needs: output styles and the registered marketplaces. Installs,
 * updates and marketplace sources are the Store's (`/rpc/store`).
 */
export type PluginRoutesService = Pick<PluginService, 'listOutputStyles' | 'listMarketplaces'>

export function createPluginRoutes(service: PluginRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get(
      '/output-styles',
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        const { projectId } = c.req.valid('query')
        const response = await service.listOutputStyles(c.get('userId'), {
          projectId: projectId ?? null,
        })
        return c.json(listOutputStylesResponseSchema.parse(response), 200)
      },
    )
    .get('/marketplaces', async (c) => {
      const marketplaces = await service.listMarketplaces(c.get('userId'))
      return c.json(listMarketplacesResponseSchema.parse({ marketplaces }))
    })

  routes.onError(defaultErrorHandler)

  return routes
}
