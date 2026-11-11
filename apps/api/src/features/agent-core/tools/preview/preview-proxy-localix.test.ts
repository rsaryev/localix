/**
 * The proxy hands a page it serves the identity of the app behind it. Behind it may be the Localix
 * API itself (an agent can open any loopback address), whose first-party origin may drive every
 * route: the API must never answer through a preview proxy, or a page the agent controls would
 * write as the person's own UI.
 */
import { afterEach, expect, test } from 'bun:test'
import { Hono } from 'hono'
import {
  createLocalOriginBoundary,
  createLocalOriginPolicy,
} from '../../../../lib/local-origin-guard'
import { buildInjectedPreviewUrl, disposeProxyServers } from './preview-proxy'

afterEach(() => disposeProxyServers())

test('the Localix API refuses every request that came through a preview proxy', async () => {
  const api = new Hono()
  // The API serving its own UI: its own origin is a first-party page.
  api.use('*', ...createLocalOriginBoundary(createLocalOriginPolicy({ servesUi: true })))
  api.get('/rpc/sessions', (c) => c.json({ sessions: ['private'] }))
  api.post('/rpc/approve', (c) => c.json({ approved: true }))
  const server = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: api.fetch })
  try {
    const apiOrigin = `http://localhost:${server.port}`
    const proxy = new URL(buildInjectedPreviewUrl(`${apiOrigin}/`)!).origin
    const write = await fetch(`${proxy}/rpc/approve`, {
      method: 'POST',
      headers: { origin: proxy, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(write.status).toBe(403)
    const read = await fetch(`${proxy}/rpc/sessions`)
    expect(read.status).toBe(403)
    // The same request made by the API's own page, not through the proxy, is served.
    const direct = await fetch(`${apiOrigin}/rpc/approve`, {
      method: 'POST',
      headers: { origin: apiOrigin, 'content-type': 'application/json' },
      body: '{}',
    })
    expect(direct.status).toBe(200)
  } finally {
    await server.stop(true)
  }
})
