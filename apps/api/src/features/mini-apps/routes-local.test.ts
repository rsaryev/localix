import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { UnprocessableError } from '../../lib/domain-errors'
import { createMiniAppRoutes, type MiniAppRoutesService } from './routes'

/** The two routes the authoring plugin calls: where the kit is, and install a package. */
function app(installs: unknown[]) {
  const service = {
    kitDir: () => '/Applications/Localix.app/Contents/Resources/resources/mini-app-kit',
    installLocal: async (userId: string, input: { dir: string; source: string }) => {
      if (input.dir.endsWith('broken'))
        throw new UnprocessableError('mini_app_package_invalid', 'Invalid mini-app.json: name')
      installs.push({ userId, ...input })
      return { name: 'tally', version: '0.1.0', warnings: [] }
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

const post = (root: Hono<AppContext>, body: unknown) =>
  root.request('/rpc/mini-apps/install-local', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('the authoring plugin’s routes', () => {
  test('GET /kit names the kit this Localix builds mini apps against', async () => {
    const response = await app([]).request('/rpc/mini-apps/kit')
    expect(await response.json()).toEqual({
      dir: '/Applications/Localix.app/Contents/Resources/resources/mini-app-kit',
    })
  })

  test('POST /install-local installs the package for the person who asked', async () => {
    const installs: unknown[] = []
    const response = await post(app(installs), {
      dir: '/src/tally/dist/package',
      source: '/src/tally',
    })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ name: 'tally', version: '0.1.0', warnings: [] })
    expect(installs).toEqual([
      { userId: 'u1', dir: '/src/tally/dist/package', source: '/src/tally' },
    ])
  })

  test('a refused package answers with Localix’s reason', async () => {
    const response = await post(app([]), { dir: '/src/broken', source: '/src' })
    expect(response.status).toBe(422)
    expect(JSON.stringify(await response.json())).toContain('Invalid mini-app.json')
  })

  test('a body without a folder is refused before anything runs', async () => {
    const installs: unknown[] = []
    expect((await post(app(installs), { source: '/src' })).status).toBe(400)
    expect(installs).toEqual([])
  })
})
