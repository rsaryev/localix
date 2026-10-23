import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import { defaultErrorHandler } from '../../lib/http'
import { listOutputStylesResponseSchema } from './output-style-listing'
import type { AppContext } from '../../app'
import {
  addMarketplaceRequestSchema,
  addMarketplaceResponseSchema,
  listMarketplacesResponseSchema,
  removeMarketplaceRequestSchema,
  installPluginRequestSchema,
  pluginRecordSchema,
  removePluginRequestSchema,
  setPluginConfigRequestSchema,
} from './contracts'
import type { PluginService } from './service-types'

/** The slice of the plugin service these routes call. */
export type PluginRoutesService = Pick<
  PluginService,
  | 'listPlugins'
  | 'listPluginCommands'
  | 'listOutputStyles'
  | 'setEnabled'
  | 'setConfig'
  | 'install'
  | 'update'
  | 'remove'
  | 'addMarketplace'
  | 'listMarketplaces'
  | 'removeMarketplace'
>

export function createPluginRoutes(service: PluginRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .post('/config', zValidator('json', setPluginConfigRequestSchema), async (c) => {
      const response = await service.setConfig(c.get('userId'), c.req.valid('json'))
      return c.json(pluginRecordSchema.parse(response), 200)
    })
    .post('/install', zValidator('json', installPluginRequestSchema), async (c) => {
      const response = await service.install(c.get('userId'), c.req.valid('json'))
      return c.json(pluginRecordSchema.parse(response), 201)
    })
    .post('/update', zValidator('json', removePluginRequestSchema), async (c) => {
      const response = await service.update(c.get('userId'), c.req.valid('json'))
      return c.json(pluginRecordSchema.parse(response), 200)
    })
    .post('/remove', zValidator('json', removePluginRequestSchema), async (c) => {
      await service.remove(c.get('userId'), c.req.valid('json'))
      return c.body(null, 204)
    })
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
    .post('/marketplaces/add', zValidator('json', addMarketplaceRequestSchema), async (c) => {
      const response = await service.addMarketplace(c.get('userId'), c.req.valid('json'))
      return c.json(addMarketplaceResponseSchema.parse(response), 201)
    })
    .post('/marketplaces/remove', zValidator('json', removeMarketplaceRequestSchema), async (c) => {
      await service.removeMarketplace(c.get('userId'), c.req.valid('json'))
      return c.body(null, 204)
    })

  routes.onError(defaultErrorHandler)

  return routes
}
