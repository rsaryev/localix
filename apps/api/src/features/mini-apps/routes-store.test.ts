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

function app(installed: string[], catalogs: string[] = []) {
  const service = {
    catalogs: {
      list: async () => [
        { url: 'https://hosted.test/mini-app-catalog.json', builtIn: true },
        ...catalogs.map((url) => ({ url, builtIn: false })),
      ],
      add: async (url: string) => void catalogs.push(url),
      remove: async (url: string) => void catalogs.splice(catalogs.indexOf(url), 1),
    },
    store: {
      list: async () => ({ entries: [entry], problems: [] }),
      install: async (name: string, opts: { acceptUnverified?: boolean }) =>
        void installed.push(opts.acceptUnverified ? `${name}!` : name),
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
    expect(await response.json()).toEqual({ entries: [entry], problems: [] })
  })

  test('an install is queued and answered at once; progress arrives as pokes', async () => {
    const installed: string[] = []
    const response = await app(installed).request('/rpc/mini-apps/store/install', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'chess', acceptUnverified: true }),
    })
    expect(response.status).toBe(202)
    expect(installed).toEqual(['chess!'])
  })

  test('the catalogs are listed, added and removed; a write answers 204 and is announced', async () => {
    const kept: string[] = []
    const root = app([], kept)
    const send = (path: string, url: string) =>
      root.request(`/rpc/mini-apps/catalogs${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url }),
      })
    expect((await send('', 'https://ada.test/c.json')).status).toBe(204)
    const listed = await (await root.request('/rpc/mini-apps/catalogs')).json()
    expect(listed).toEqual({
      catalogs: [
        { url: 'https://hosted.test/mini-app-catalog.json', builtIn: true },
        { url: 'https://ada.test/c.json', builtIn: false },
      ],
    })
    expect((await send('/remove', 'https://ada.test/c.json')).status).toBe(204)
    expect(kept).toEqual([])
  })
})
