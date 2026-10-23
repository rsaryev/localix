import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { createMiniAppRoutes, type MiniAppRoutesService } from './routes'
import { NotFoundError } from '../../lib/domain-errors'
import type { MiniAppStoreEntry } from './store'

const entry: MiniAppStoreEntry = {
  name: 'chess',
  displayName: 'Chess',
  description: 'Play chess',
  category: 'games',
  version: '1.0.0',
  publisher: { name: 'Localix', verified: true },
  source: 'https://hosted.test/mini-app-catalog.json',
  icon: '/rpc/mini-apps/store/media/chess/icon?v=abc',
  tags: ['game'],
  installed: null,
  update: false,
}
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"/>')
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47])

function app(installed: string[], catalogs: string[] = []) {
  const service = {
    appIcon: async (_userId: string, { app }: { app: string }) => {
      if (app !== 'chess')
        throw new NotFoundError('mini_app_icon_not_found', `"${app}" has no icon`)
      return { bytes: SVG, type: 'image/svg+xml' }
    },
    catalogs: {
      list: async () => [
        { url: 'https://hosted.test/mini-app-catalog.json', builtIn: true },
        ...catalogs.map((url) => ({ url, builtIn: false })),
      ],
      add: async (url: string) => void catalogs.push(url),
      remove: async (url: string) => void catalogs.splice(catalogs.indexOf(url), 1),
      preview: async (url: string) => ({
        url,
        publishers: ['Ada'],
        apps: 2,
        icons: [],
        verified: false,
        added: false,
      }),
    },
    store: {
      list: async () => ({ entries: [entry], problems: [] }),
      detail: async (name: string) => ({
        entry: { ...entry, name },
        readme: '# Chess',
        screenshots: [{ url: '/rpc/mini-apps/store/media/chess/screenshot/0?v=abc' }],
        details: { version: '1.0.0', size: 120, license: 'MIT' },
      }),
      media: async (_name: string, kind: string, index?: number) =>
        kind === 'icon'
          ? { bytes: SVG, type: 'image/svg+xml' }
          : { bytes: PNG, type: 'image/png', index },
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

  test('one app’s store page: its row, README, screenshots and details', async () => {
    const response = await app([]).request('/rpc/mini-apps/store/chess')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      entry: { name: 'chess' },
      readme: '# Chess',
      details: { size: 120 },
    })
  })

  test('media are served with their type, never sniffed, and an SVG cannot run anything', async () => {
    const icon = await app([]).request('/rpc/mini-apps/store/media/chess/icon')
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-type')).toBe('image/svg+xml')
    expect(icon.headers.get('x-content-type-options')).toBe('nosniff')
    expect(icon.headers.get('content-security-policy')).toBe(
      "default-src 'none'; style-src 'unsafe-inline'",
    )
    const shot = await app([]).request('/rpc/mini-apps/store/media/chess/screenshot/0?v=abc')
    expect(shot.headers.get('content-type')).toBe('image/png')
    expect(shot.headers.get('cache-control')).toContain('immutable')
    expect(new Uint8Array(await shot.arrayBuffer())).toEqual(PNG)
    expect((await app([]).request('/rpc/mini-apps/store/media/chess/readme')).status).toBe(400)
  })

  test('a catalog is previewed before it is added', async () => {
    const response = await app([]).request('/rpc/mini-apps/catalogs/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://ada.test/c.json' }),
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ publishers: ['Ada'], apps: 2, verified: false })
  })

  test('an installed app’s own icon is served the same way, and one with none is a 404', async () => {
    const icon = await app([]).request('/rpc/mini-apps/chess/icon?v=1.0.0')
    expect(icon.status).toBe(200)
    expect(icon.headers.get('content-security-policy')).toContain("default-src 'none'")
    expect((await app([]).request('/rpc/mini-apps/notes/icon')).status).toBe(404)
  })
})
