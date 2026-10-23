import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createMiniAppRoutes, type MiniAppRoutesService } from './routes'
import type { MiniAppStoreEntry } from './store'

const entry: MiniAppStoreEntry = {
  name: 'chess',
  displayName: 'Chess',
  description: 'Play chess',
  category: 'games',
  version: '1.0.0',
  publisher: { name: 'Localix', verified: true },
  installed: null,
  update: false,
}

function app(installed: string[]) {
  const service = {
    store: {
      list: async () => [entry],
      install: async (name: string) => void installed.push(name),
    },
  } as unknown as MiniAppRoutesService
  const root = new Hono<AppContext>()
  root.use('*', async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  root.route('/rpc/mini-apps', createMiniAppRoutes(service))
  return root
}

describe('/rpc/mini-apps/store', () => {
  test('lists what the catalogs offer', async () => {
    const response = await app([]).request('/rpc/mini-apps/store')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ entries: [entry] })
  })

  test('an install is queued and answered at once; progress arrives as pokes', async () => {
    const installed: string[] = []
    const response = await app(installed).request('/rpc/mini-apps/store/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'chess' }),
    })
    expect(response.status).toBe(202)
    expect(installed).toEqual(['chess'])
  })
})
