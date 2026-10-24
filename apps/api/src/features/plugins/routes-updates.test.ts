import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createPluginRoutes, type PluginRoutesService } from './routes'
import type { PluginUpdatesResponse } from './contracts-updates'

const status: PluginUpdatesResponse = {
  available: [{ id: 'tool@shop', name: 'tool', marketplace: 'shop', from: '1.0.0', to: '2.0.0' }],
  jobs: [{ id: 'other@shop', phase: 'failed', error: 'offline' }],
  lastCheckedAt: '2026-10-24T00:00:00.000Z',
}

function app() {
  const calls: unknown[][] = []
  const record =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args])
    }
  const service = {
    updates: {
      status: async (...args: unknown[]) => (record('status')(...args), status),
      apply: async (_userId: string, ids?: string[]) => ({ queued: ids ?? ['tool@shop'] }),
    },
    updateMarketplace: async (...args: unknown[]) => (
      record('updateMarketplace')(...args),
      { name: 'shop', count: 2, updated: ['tool'], manual: ['gated'], warnings: [] }
    ),
    refreshMarketplaces: async (...args: unknown[]) => (
      record('refreshMarketplaces')(...args),
      { refreshed: ['shop'], updated: [], manual: [], warnings: [] }
    ),
    setMarketplaceAutoUpdate: async (...args: unknown[]) => {
      record('setMarketplaceAutoUpdate')(...args)
    },
  } as unknown as PluginRoutesService
  const hono = new Hono<AppContext>()
  hono.use(async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  hono.route('/rpc/plugins', createPluginRoutes(service))
  return { hono, calls }
}

const post = (body: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('plugin update routes', () => {
  test('GET /updates answers the activity-center shape; ?refresh=1 asks for a refresh', async () => {
    const { hono, calls } = app()
    const res = await hono.request('/rpc/plugins/updates')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(status)
    await hono.request('/rpc/plugins/updates?refresh=1')
    expect(calls).toEqual([
      ['status', 'u1', { refresh: false }],
      ['status', 'u1', { refresh: true }],
    ])
  })

  test('POST /updates/apply queues the named updates, or every one, and answers 202', async () => {
    const { hono } = app()
    const all = await hono.request('/rpc/plugins/updates/apply', post({}))
    expect(all.status).toBe(202)
    expect(await all.json()).toEqual({ queued: ['tool@shop'] })
    const some = await hono.request('/rpc/plugins/updates/apply', post({ ids: ['x@y'] }))
    expect(await some.json()).toEqual({ queued: ['x@y'] })
  })

  test('POST /marketplaces/update with a name updates it; without one refreshes listings', async () => {
    const { hono, calls } = app()
    const named = await hono.request('/rpc/plugins/marketplaces/update', post({ name: 'shop' }))
    expect(await named.json()).toEqual({
      refreshed: ['shop'],
      updated: ['tool'],
      manual: ['gated'],
      warnings: [],
    })
    const all = await hono.request('/rpc/plugins/marketplaces/update', post({}))
    expect((await all.json()).updated).toEqual([])
    expect(calls.map((call) => call[0])).toEqual(['updateMarketplace', 'refreshMarketplaces'])
  })

  test('POST /marketplaces/auto-update records the toggle', async () => {
    const { hono, calls } = app()
    const res = await hono.request(
      '/rpc/plugins/marketplaces/auto-update',
      post({ name: 'shop', autoUpdate: true }),
    )
    expect(res.status).toBe(204)
    expect(calls).toEqual([['setMarketplaceAutoUpdate', 'u1', { name: 'shop', autoUpdate: true }]])
  })
})
