/// <reference types="bun" />

import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { request as httpRequest } from 'node:http'

import { createApp } from './app'
import { createDatabase, destroyDatabase } from './db'
import { createTestCatalogService, createTestChatService } from './features/chat/test-harness'
import { websocket } from './features/realtime/ws'
import { LOCALIX_CLIENT_HEADER } from './lib/client-header'
import { createLocalOriginPolicy, parseUiOrigins } from './lib/local-origin-guard'
import { createLogger } from './lib/logger'
import { testWork } from './testing/work-fixture'

/**
 * The composition root over a REAL socket: the guard is only worth anything if `createApp` mounts
 * it in front of every route, the websocket upgrade included. A unit test of the middleware cannot
 * show that, and the four doors it closes (`lib/local-origin-guard.ts`) were all at this level.
 */

const DEV_UI = 'http://localhost:5050'
const db = createDatabase()
let server: ReturnType<typeof Bun.serve>
let base: string

beforeAll(() => {
  const catalogService = createTestCatalogService()
  const providerConnectionsService = {
    // The provider's own error text reaches the failure page; it must arrive as text.
    completeOAuth: async () => {
      throw new Error('<script>alert(document.domain)</script>')
    },
  }
  const chatService = createTestChatService({
    db,
    work: testWork(db),
    catalogService,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    providerConnectionsService: providerConnectionsService as any,
  })
  const app = createApp({
    logger: createLogger('error'),
    defaultUserId: 'local-user',
    catalogService,
    chatService,
    providerConnectionsService,
    // The same parse the boot runs over `LOCALIX_UI_ORIGINS`.
    originPolicy: createLocalOriginPolicy({ uiOrigins: parseUiOrigins(DEV_UI) }),
    // The rest of the dep set is never dereferenced on these paths.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)
  server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: app.fetch, websocket })
  base = `http://127.0.0.1:${server.port}`
})

afterAll(async () => {
  await server.stop(true)
  await destroyDatabase(db)
})

/** Open a socket; resolves with whether the handshake succeeded. */
function openSocket(headers: Record<string, string>): Promise<boolean> {
  return new Promise((resolve) => {
    // Bun's client takes handshake headers; a browser sets `Origin` itself.
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/rpc/ws`, {
      headers,
    } as unknown as string[])
    const timer = setTimeout(() => resolve(false), 5000)
    socket.addEventListener('open', () => {
      clearTimeout(timer)
      socket.close()
      resolve(true)
    })
    socket.addEventListener('error', () => {
      clearTimeout(timer)
      resolve(false)
    })
  })
}

/** A request with a forged `Host`, which `fetch` would replace with the URL's. */
function withHost(host: string, path: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port: server.port, path, method: 'GET', headers: { host } },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      },
    )
    req.setTimeout(5000, () => req.destroy(new Error('timed out')))
    req.on('error', reject)
    req.end()
  })
}

describe('createApp local-origin guard, over a real socket', () => {
  it('refuses a websocket from a foreign page before the upgrade', async () => {
    expect(await openSocket({ origin: 'https://evil.example' })).toBe(false)
    // A preview server on another loopback port is a foreign page too.
    expect(await openSocket({ origin: 'http://127.0.0.1:7777' })).toBe(false)
    const res = await fetch(`${base}/rpc/ws`, {
      headers: {
        origin: 'https://evil.example',
        upgrade: 'websocket',
        connection: 'Upgrade',
        'sec-websocket-version': '13',
        'sec-websocket-key': 'dGhlIHNhbXBsZSBub25jZQ==',
      },
    })
    expect(res.status).toBe(403)
  })

  it('opens the websocket for the app pages and for a client with no Origin', async () => {
    expect(await openSocket({ origin: 'tauri://localhost' })).toBe(true)
    expect(await openSocket({ origin: DEV_UI })).toBe(true)
    expect(await openSocket({})).toBe(true)
  })

  it('refuses a cross-site write, with or without a body', async () => {
    for (const init of [
      { method: 'POST' },
      { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' },
      { method: 'DELETE' },
    ]) {
      const res = await fetch(`${base}/rpc/webhook/messages`, {
        ...init,
        headers: { ...init.headers, origin: 'https://evil.example' },
      })
      expect(res.status).toBe(403)
    }
  })

  it('refuses a body-less write with no Origin and no client header', async () => {
    const res = await fetch(`${base}/rpc/webhook/messages`, { method: 'POST' })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'client_header_required',
    )
  })

  it('lets first-party writes through to the route', async () => {
    const body = JSON.stringify({ sessionId: 'missing', prompt: 'hi' })
    // The UI transport: allowed Origin plus the header.
    const fromUi = await fetch(`${base}/rpc/webhook/messages`, {
      method: 'POST',
      headers: { origin: DEV_UI, [LOCALIX_CLIENT_HEADER]: '1', 'content-type': 'application/json' },
      body,
    })
    // The documented curl call: JSON, no Origin, no header.
    const fromCurl = await fetch(`${base}/rpc/webhook/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
    for (const res of [fromUi, fromCurl]) {
      // Past the guard: the route itself answers (the session does not exist).
      expect(res.status).not.toBe(403)
      expect(res.status).toBe(409)
    }
  })

  it('refuses a DNS-rebound Host on every path, and serves loopback names', async () => {
    expect(await withHost(`evil.example:${server.port}`, '/health')).toBe(403)
    expect(await withHost(`evil.example:${server.port}`, '/rpc/ws')).toBe(403)
    expect(await withHost(`localhost:${server.port}`, '/health')).toBe(200)
  })

  it('reflects CORS only for allowed origins; a preview origin is refused its preflight', async () => {
    const preflight = (origin: string) =>
      fetch(`${base}/rpc/webhook/messages`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': LOCALIX_CLIENT_HEADER,
        },
      })
    const ok = await preflight(DEV_UI)
    expect(ok.status).toBe(204)
    expect(ok.headers.get('access-control-allow-origin')).toBe(DEV_UI)
    const preview = await preflight('http://127.0.0.1:7777')
    expect(preview.status).toBe(403)
    expect(preview.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('escapes the provider error on the OAuth failure page', async () => {
    const res = await fetch(`${base}/oauth?code=c&state=s`)
    expect(res.status).toBe(400)
    const html = await res.text()
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(document.domain)&lt;/script&gt;')
  })
})
