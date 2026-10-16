import { Hono } from 'hono'
import { zValidator } from '../../lib/validator'

import type { AppContext } from '../../app'
import { defaultErrorHandler, jsonError } from '../../lib/http'
import { uiLocationCatalogPublishSchema } from './contracts'
import type { UiLocationCatalogService } from './service'

export interface UiLocationCatalogRouteDeps {
  assertProjectAccess(userId: string, projectId: string): Promise<void>
}

export function createUiLocationCatalogRoutes(
  service: UiLocationCatalogService,
  deps: UiLocationCatalogRouteDeps,
) {
  const app = new Hono<AppContext>()

  const routes = app.put(
    '/catalog',
    zValidator('json', uiLocationCatalogPublishSchema),
    async (context) => {
      const body = context.req.valid('json')
      if (body.projectId) {
        await deps.assertProjectAccess(context.get('userId'), body.projectId)
      }
      const result = service.publish({
        userId: context.get('userId'),
        publisherId: body.publisherId,
        projectId: body.projectId,
        catalog: body.catalog,
      })
      if (result.status === 'invalid') {
        return jsonError(
          context,
          422,
          'ui_catalog_invalid',
          'UI location catalog failed strict validation',
        )
      }
      if (result.status === 'conflict') {
        return jsonError(
          context,
          409,
          'ui_catalog_revision_conflict',
          'The same UI catalog publisher revision carried different content',
        )
      }
      return context.json({
        catalogId: result.catalogId,
        accepted: result.status === 'accepted',
      })
    },
  )

  routes.onError(defaultErrorHandler)
  return routes
}
