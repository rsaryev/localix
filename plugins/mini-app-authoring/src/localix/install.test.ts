import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '../testing/temp'
import { installIntoLocalix, reachLocalix } from './install'
import { findLocalix } from './runtime'

const tempDir = tempDirPerTest('mini-app-localix-')

/** A Localix API on `baseUrl`, as fetch sees it; `requests` records what it was asked. */
function localix(baseUrl: string, routes: Record<string, (body: unknown) => Response>) {
  const requests: { path: string; body: unknown }[] = []
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    const target = new URL(String(url))
    if (target.origin !== new URL(baseUrl).origin) throw new TypeError('connection refused')
    if (target.pathname === '/health') return Response.json({ productId: 'localix-api' })
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined
    requests.push({ path: target.pathname, body })
    return routes[target.pathname]?.(body) ?? new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
  return { fetchImpl, requests }
}

function runtimeFile(home: string, baseUrl: string) {
  writeTree(home, { '.localix/localix.db.api-runtime.json': JSON.stringify({ baseUrl, pid: 1 }) })
}

describe('findLocalix', () => {
  test('finds the API the runtime file names when it answers as Localix', async () => {
    const home = tempDir()
    runtimeFile(home, 'http://127.0.0.1:5051')
    const { fetchImpl } = localix('http://127.0.0.1:5051', {})
    expect(await findLocalix({ env: {}, home, fetch: fetchImpl })).toEqual({
      baseUrl: 'http://127.0.0.1:5051',
    })
  })

  test('a stale runtime file is not a running Localix', async () => {
    const home = tempDir()
    runtimeFile(home, 'http://127.0.0.1:5999')
    const { fetchImpl } = localix('http://127.0.0.1:5051', {})
    expect(await findLocalix({ env: {}, home, fetch: fetchImpl })).toBeNull()
  })
})

describe('installing into Localix', () => {
  test('hands the package and its source to the running Localix', async () => {
    const home = tempDir()
    runtimeFile(home, 'http://127.0.0.1:5051')
    const { fetchImpl, requests } = localix('http://127.0.0.1:5051', {
      '/rpc/mini-apps/install-local': () =>
        Response.json({ name: 'gpu-monitor', version: '0.1.0', warnings: [] }),
    })
    const installed = await installIntoLocalix('/src/gpu/dist/package', '/src/gpu', {
      env: {},
      home,
      fetch: fetchImpl,
      app: null,
    })
    expect(installed.name).toBe('gpu-monitor')
    expect(requests).toEqual([
      {
        path: '/rpc/mini-apps/install-local',
        body: { dir: '/src/gpu/dist/package', source: '/src/gpu' },
      },
    ])
  })

  test('a refusal comes back with the reason Localix gave', async () => {
    const home = tempDir()
    runtimeFile(home, 'http://127.0.0.1:5051')
    const { fetchImpl } = localix('http://127.0.0.1:5051', {
      '/rpc/mini-apps/install-local': () =>
        Response.json({ message: 'mini-app.json: name is required' }, { status: 400 }),
    })
    await expect(
      installIntoLocalix('/p', '/s', { env: {}, home, fetch: fetchImpl, app: null }),
    ).rejects.toThrow('name is required')
  })

  test('opens the installed app when Localix is not running, then waits for it', async () => {
    const home = tempDir()
    const app = join(home, 'Applications', 'Localix.app')
    writeTree(app, { 'Contents/Info.plist': '' })
    const { fetchImpl } = localix('http://127.0.0.1:5051', {})
    const launched: string[] = []
    const runtime = await reachLocalix({
      env: {},
      home,
      fetch: fetchImpl,
      app,
      launch: async (path) => {
        launched.push(path)
        runtimeFile(home, 'http://127.0.0.1:5051')
      },
      sleep: async () => undefined,
    })
    expect(launched).toEqual([app])
    expect(runtime.baseUrl).toBe('http://127.0.0.1:5051')
  })

  test('says how to get Localix when it is neither running nor installed', async () => {
    const { fetchImpl } = localix('http://127.0.0.1:5051', {})
    await expect(
      reachLocalix({ env: {}, home: tempDir(), fetch: fetchImpl, app: null }),
    ).rejects.toThrow('mini-app get-localix')
  })
})
