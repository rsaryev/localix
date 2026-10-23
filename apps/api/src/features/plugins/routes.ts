import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'
import { z } from 'zod'

import { defaultErrorHandler } from '../../lib/http'
import { argOptionSchema } from './arg-options'
import { listOutputStylesResponseSchema } from './output-style-listing'
import type { AppContext } from '../../app'
import {
  addMarketplaceRequestSchema,
  addMarketplaceResponseSchema,
  listMarketplacesResponseSchema,
  removeMarketplaceRequestSchema,
  installPluginRequestSchema,
  pluginViewHtmlResponseSchema,
  invokePluginUiActionRequestSchema,
  invokePluginUiActionResponseSchema,
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
  | 'resolvePluginArgOptions'
  | 'listPluginViews'
  | 'listOutputStyles'
  | 'getViewHtml'
  | 'resolveUiFile'
  | 'invokeUiAction'
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
    .post(
      '/command-args/options',
      zValidator(
        'json',
        z.object({
          plugin: z.string().min(1),
          command: z.string().min(1),
          arg: z.string().min(1),
          query: z.string().optional(),
          sessionId: z.string().optional(),
          projectId: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid('json')
        const response = await service.resolvePluginArgOptions(c.get('userId'), {
          ...body,
          projectId: body.projectId ?? null,
        })
        return c.json(z.object({ options: z.array(argOptionSchema) }).parse(response), 200)
      },
    )
    // One bundled plugin's UI artifact file, imported by the host as an ES module. The entry and
    // manifest are revalidated (the host asks for them with `?v=<revision>`); everything else is
    // content-hashed and never changes under its name. `Content-Type` is set explicitly because
    // the `cors()` middleware clones the response and drops Bun's lazy type, and a module script
    // without a JavaScript type is refused.
    .get('/:plugin/ui/*', async (c) => {
      const plugin = c.req.param('plugin')
      const file = decodeURIComponent(c.req.path.slice(c.req.path.indexOf('/ui/') + 4))
      const path = await service.resolveUiFile(c.get('userId'), { pluginName: plugin, file })
      const body = Bun.file(path)
      if (!(await body.exists())) {
        return c.json({ error: { code: 'plugin_ui_not_found', message: 'No such UI file' } }, 404)
      }
      const hashed = file.startsWith('chunks/') || file.startsWith('assets/')
      return new Response(body, {
        headers: {
          'Content-Type': body.type,
          'Cache-Control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
        },
      })
    })
    .get(
      '/views/:plugin/:id',
      zValidator('param', z.object({ plugin: z.string().min(1), id: z.string().min(1) })),
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        const { plugin, id } = c.req.valid('param')
        const { projectId } = c.req.valid('query')
        const response = await service.getViewHtml(c.get('userId'), {
          pluginName: plugin,
          viewId: id,
          projectId: projectId ?? null,
        })
        return c.json(pluginViewHtmlResponseSchema.parse(response), 200)
      },
    )
    .post(
      '/ui-actions/invoke',
      zValidator('json', invokePluginUiActionRequestSchema),
      async (c) => {
        const response = await service.invokeUiAction(c.get('userId'), c.req.valid('json'))
        return c.json(invokePluginUiActionResponseSchema.parse(response), 200)
      },
    )
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
