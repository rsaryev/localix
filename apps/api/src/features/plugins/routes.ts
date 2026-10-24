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
  updatePluginRequestSchema,
  setPluginConfigRequestSchema,
} from './contracts'
import type { PluginService } from './service-types'
import {
  applyPluginUpdatesRequestSchema,
  applyPluginUpdatesResponseSchema,
  pluginUpdatesResponseSchema,
  setMarketplaceAutoUpdateRequestSchema,
  updateMarketplaceRequestSchema,
  updateMarketplaceResponseSchema,
} from './contracts-updates'

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
  | 'updateMarketplace'
  | 'refreshMarketplaces'
  | 'setMarketplaceAutoUpdate'
> & { updates: Pick<PluginService['updates'], 'status' | 'apply'> }

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
    .post('/update', zValidator('json', updatePluginRequestSchema), async (c) => {
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
    // With a name, Claude Code's "Update marketplace" (its listing and the plugins installed from
    // it); without one, `marketplace update`: every listing refreshed, no plugin touched.
    .post('/marketplaces/update', zValidator('json', updateMarketplaceRequestSchema), async (c) => {
      const { name } = c.req.valid('json')
      const userId = c.get('userId')
      if (!name) {
        const refreshed = await service.refreshMarketplaces(userId)
        return c.json(updateMarketplaceResponseSchema.parse(refreshed), 200)
      }
      const res = await service.updateMarketplace(userId, { name })
      return c.json(
        updateMarketplaceResponseSchema.parse({
          refreshed: [res.name],
          updated: res.updated,
          manual: res.manual,
          warnings: res.warnings,
        }),
        200,
      )
    })
    .post(
      '/marketplaces/auto-update',
      zValidator('json', setMarketplaceAutoUpdateRequestSchema),
      async (c) => {
        await service.setMarketplaceAutoUpdate(c.get('userId'), c.req.valid('json'))
        return c.body(null, 204)
      },
    )
    // The background-activity center: what can be updated, and the updates in flight. Without
    // `refresh` the last check answers (computed locally the first time); progress of an apply
    // arrives as `plugin-updates` pokes.
    .get(
      '/updates',
      zValidator('query', z.object({ refresh: z.string().optional() })),
      async (c) => {
        const { refresh } = c.req.valid('query')
        const status = await service.updates.status(c.get('userId'), {
          refresh: refresh === '1' || refresh === 'true',
        })
        return c.json(pluginUpdatesResponseSchema.parse(status), 200)
      },
    )
    .post('/updates/apply', zValidator('json', applyPluginUpdatesRequestSchema), async (c) => {
      const queued = await service.updates.apply(c.get('userId'), c.req.valid('json').ids)
      return c.json(applyPluginUpdatesResponseSchema.parse(queued), 202)
    })

  routes.onError(defaultErrorHandler)

  return routes
}
