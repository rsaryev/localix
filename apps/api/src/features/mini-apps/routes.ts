import { Hono } from 'hono'
import { z } from 'zod'

import { defaultErrorHandler } from '../../lib/http'
import { zValidator } from '../../lib/validator'
import type { AppContext } from '../../app'
import { argOptionSchema } from './arg-options'
import {
  invokeMiniAppUiActionRequestSchema,
  invokeMiniAppUiActionResponseSchema,
  miniAppViewHtmlResponseSchema,
} from './contracts-contributions'
import {
  listMiniAppsResponseSchema,
  removeMiniAppRequestSchema,
  setMiniAppConfigRequestSchema,
  setMiniAppEnabledRequestSchema,
} from './contracts'
import type { MiniAppService } from './service'
import { installMiniAppRequestSchema, miniAppStoreResponseSchema } from './contracts-store'

/** The slice of the mini app service these routes call. */
export type MiniAppRoutesService = Pick<
  MiniAppService,
  | 'list'
  | 'setEnabled'
  | 'setConfig'
  | 'remove'
  | 'resolveArgOptions'
  | 'resolveUiFile'
  | 'getViewHtml'
  | 'invokeUiAction'
  | 'store'
>

/**
 * `/rpc/mini-apps`: the mini apps of a scope, their switches and settings, and what their screens
 * call. A write answers 204: every surface re-reads on the `mini-app` notice the write recorded
 * (P11), so no response carries state a client would patch in.
 */
export function createMiniAppRoutes(service: MiniAppRoutesService) {
  const app = new Hono<AppContext>()

  const routes = app
    .get('/', zValidator('query', z.object({ projectId: z.string().optional() })), async (c) => {
      const { projectId } = c.req.valid('query')
      const response = await service.list(c.get('userId'), { projectId: projectId ?? null })
      return c.json(listMiniAppsResponseSchema.parse(response), 200)
    })
    .post('/enable', zValidator('json', setMiniAppEnabledRequestSchema), async (c) => {
      await service.setEnabled(c.get('userId'), c.req.valid('json'))
      return c.body(null, 204)
    })
    .post('/config', zValidator('json', setMiniAppConfigRequestSchema), async (c) => {
      await service.setConfig(c.get('userId'), c.req.valid('json'))
      return c.body(null, 204)
    })
    .post('/remove', zValidator('json', removeMiniAppRequestSchema), async (c) => {
      await service.remove(c.get('userId'), c.req.valid('json'))
      return c.body(null, 204)
    })
    // The store: what the catalogs offer, and installs queued here whose progress arrives as
    // `mini-app-installs` pokes the client answers by reading the list again.
    .get('/store', async (c) =>
      c.json(miniAppStoreResponseSchema.parse({ entries: await service.store.list() }), 200),
    )
    .post('/store/install', zValidator('json', installMiniAppRequestSchema), async (c) => {
      await service.store.install(c.req.valid('json').name)
      return c.body(null, 202)
    })
    .post(
      '/command-args/options',
      zValidator(
        'json',
        z.object({
          app: z.string().min(1),
          command: z.string().min(1),
          arg: z.string().min(1),
          query: z.string().optional(),
          sessionId: z.string().optional(),
          projectId: z.string().optional(),
        }),
      ),
      async (c) => {
        const body = c.req.valid('json')
        const response = await service.resolveArgOptions(c.get('userId'), {
          ...body,
          projectId: body.projectId ?? null,
        })
        return c.json(z.object({ options: z.array(argOptionSchema) }).parse(response), 200)
      },
    )
    // One mini app's UI artifact file, imported by the host as an ES module. The entry and
    // manifest are revalidated (the host asks for them with `?v=<revision>`); everything else is
    // content-hashed and never changes under its name. `Content-Type` is set explicitly because
    // the `cors()` middleware clones the response and drops Bun's lazy type, and a module script
    // without a JavaScript type is refused.
    .get('/:app/ui/*', async (c) => {
      const name = c.req.param('app')
      const file = decodeURIComponent(c.req.path.slice(c.req.path.indexOf('/ui/') + 4))
      const path = await service.resolveUiFile(c.get('userId'), { app: name, file })
      const body = Bun.file(path)
      if (!(await body.exists())) {
        return c.json({ error: { code: 'mini_app_ui_not_found', message: 'No such UI file' } }, 404)
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
      '/views/:app/:id',
      zValidator('param', z.object({ app: z.string().min(1), id: z.string().min(1) })),
      zValidator('query', z.object({ projectId: z.string().optional() })),
      async (c) => {
        const { app: name, id } = c.req.valid('param')
        const { projectId } = c.req.valid('query')
        const response = await service.getViewHtml(c.get('userId'), {
          app: name,
          viewId: id,
          projectId: projectId ?? null,
        })
        return c.json(miniAppViewHtmlResponseSchema.parse(response), 200)
      },
    )
    .post(
      '/ui-actions/invoke',
      zValidator('json', invokeMiniAppUiActionRequestSchema),
      async (c) => {
        const response = await service.invokeUiAction(c.get('userId'), c.req.valid('json'))
        return c.json(invokeMiniAppUiActionResponseSchema.parse(response), 200)
      },
    )

  routes.onError(defaultErrorHandler)

  return routes
}
