import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import { UI_AGENT_LOCATION_CATALOG_VERSION } from '@localixai/plugin-sdk/ui'
import type { AppContext } from '../../app'
import { ApiError } from '../../lib/errors'
import { createUiLocationCatalogRoutes } from './routes'
import { createUiLocationCatalogService } from './service'

function testApp(projects = new Set(['p1'])) {
  const app = new Hono<AppContext>()
  app.use('*', async (context, next) => {
    context.set('userId', 'u1')
    await next()
  })
  app.route(
    '/rpc/ui-locations',
    createUiLocationCatalogRoutes(createUiLocationCatalogService(), {
      assertProjectAccess: async (_userId, projectId) => {
        if (!projects.has(projectId)) {
          throw new ApiError(404, 'project_not_found', 'Project not found')
        }
      },
    }),
  )
  return app
}

const catalog = {
  version: UI_AGENT_LOCATION_CATALOG_VERSION,
  revision: 1,
  locations: [
    {
      uri: 'localix://ui/settings/tools',
      title: 'Tools',
      description: 'Open tool settings.',
      surface: 'settings',
      params: {},
    },
  ],
}

describe('PUT /rpc/ui-locations/catalog', () => {
  test('publishes one scoped catalog and returns its immutable id', async () => {
    const response = await testApp().request('/rpc/ui-locations/catalog', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publisherId: 'page-a',
        projectId: 'p1',
        catalog,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      catalogId: expect.stringMatching(/^ui1_/),
      accepted: true,
    })
  })

  test('rejects malformed catalogs before changing service state', async () => {
    const response = await testApp().request('/rpc/ui-locations/catalog', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publisherId: 'page-a',
        projectId: null,
        catalog: {
          ...catalog,
          locations: [{ ...catalog.locations[0], uri: 'localix://ui/action/state/reset' }],
        },
      }),
    })

    expect(response.status).toBe(422)
    expect(await response.json()).toMatchObject({
      error: { code: 'ui_catalog_invalid' },
    })
  })

  test('checks project ownership before accepting a scoped catalog', async () => {
    const response = await testApp().request('/rpc/ui-locations/catalog', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        publisherId: 'page-a',
        projectId: 'foreign',
        catalog,
      }),
    })

    expect(response.status).toBe(404)
  })
})
