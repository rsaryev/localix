import { afterEach, describe, expect, test } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest } from '@localixai/testing'

import { createAesCipher } from '../../secrets/cipher'
import type { McpServerRecord } from '../repository'
import { startMcpOAuth } from './flow'
import { createMcpOAuthStore } from './store'

/**
 * What a person's authorization server is sent from a Claude Code `oauth` block: the pre-registered
 * client, the pinned scopes (over what the server advertises), a fixed callback port in the
 * redirect, and the metadata document named by `authServerMetadataUrl`.
 */
const dir = tempDirPerTest('mcp-oauth-config-')
const stores = () =>
  createMcpOAuthStore({ dir: join(dir(), 'oauth'), cipher: createAesCipher(Buffer.alloc(32, 7)) })

let running: Array<{ stop(force?: boolean): unknown }> = []
afterEach(async () => {
  await Promise.all(running.map((s) => s.stop(true)))
  running = []
})

interface Hit {
  method: string
  path: string
  body: string
}

/** A protected MCP resource that is also its own authorization server. */
function authServer(metadata: Record<string, unknown> = {}) {
  const hits: Hit[] = []
  const server: ReturnType<typeof Bun.serve> = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request): Promise<Response> {
      const url = new URL(request.url)
      hits.push({ method: request.method, path: url.pathname, body: await request.text() })
      const base = `http://127.0.0.1:${server.port}`
      if (url.pathname === '/mcp') return new Response('denied', { status: 401 })
      if (
        url.pathname === '/.well-known/oauth-authorization-server' ||
        url.pathname === '/custom/metadata'
      )
        return Response.json({
          issuer: base,
          authorization_endpoint: `${base}/authorize`,
          token_endpoint: `${base}/token`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          ...metadata,
          ...(url.pathname === '/custom/metadata' ? { issuer: base } : {}),
        })
      if (url.pathname === '/token')
        return Response.json({ access_token: 'granted', token_type: 'bearer' })
      return new Response('not found', { status: 404 })
    },
  })
  running.push(server)
  return { base: `http://127.0.0.1:${server.port}`, hits }
}

const record = (url: string, oauth: Record<string, unknown>): McpServerRecord => ({
  id: 'claude-code:project:api',
  userId: 'u',
  projectId: '',
  name: 'api',
  description: '',
  transport: 'http',
  config: { url, oauth },
  createdAt: '',
  updatedAt: '',
})

async function authorizeUrl(server: McpServerRecord) {
  const started = await startMcpOAuth(server, { store: stores() })
  return new URL(started.authorizationUrl ?? 'http://missing.invalid')
}

async function freePort() {
  const probe = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
  const port = probe.port
  await probe.stop(true)
  return port
}

describe('a server’s oauth block', () => {
  test('asks as the pre-registered client with the pinned scopes, not the advertised ones', async () => {
    const { base } = authServer({ scopes_supported: ['openid', 'email'] })
    const url = await authorizeUrl(
      record(`${base}/mcp`, { clientId: 'cid', scope: 'channels:read chat:write' }),
    )
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('client_id')).toBe('cid')
    expect(url.searchParams.get('scope')).toBe('channels:read chat:write')
  })

  test('adds offline_access to pinned scopes when the server lists it, so tokens refresh', async () => {
    const { base } = authServer({ scopes_supported: ['openid', 'offline_access'] })
    const url = await authorizeUrl(record(`${base}/mcp`, { clientId: 'cid', scope: 'openid' }))
    expect(url.searchParams.get('scope')).toBe('openid offline_access')
    expect(url.searchParams.get('prompt')).toBe('consent')
  })

  test('with no pinned scope and default discovery, asks for no scope of its own', async () => {
    const { base } = authServer({ scopes_supported: ['openid', 'email'] })
    const url = await authorizeUrl(record(`${base}/mcp`, { clientId: 'cid' }))
    expect(url.searchParams.has('scope')).toBe(false)
  })

  test('authServerMetadataUrl replaces the discovery chain, and its scopes_supported are asked for', async () => {
    const { base, hits } = authServer({ scopes_supported: ['a', 'b'] })
    const url = await authorizeUrl(
      record(`${base}/mcp`, { clientId: 'cid', authServerMetadataUrl: `${base}/custom/metadata` }),
    )
    expect(url.pathname).toBe('/authorize')
    expect(url.searchParams.get('scope')).toBe('a b')
    expect(hits.some((h) => h.path === '/custom/metadata')).toBe(true)
    expect(hits.some((h) => h.path === '/.well-known/oauth-authorization-server')).toBe(false)
  })

  test('pinned scopes win over the metadata URL’s', async () => {
    const { base } = authServer({ scopes_supported: ['a', 'b'] })
    const url = await authorizeUrl(
      record(`${base}/mcp`, {
        clientId: 'cid',
        scope: 'only',
        authServerMetadataUrl: `${base}/custom/metadata`,
      }),
    )
    expect(url.searchParams.get('scope')).toBe('only')
  })

  test('a callbackPort is the redirect, and a listener there completes the sign-in', async () => {
    const { base, hits } = authServer()
    const port = await freePort()
    const store = stores()
    const started = await startMcpOAuth(
      record(`${base}/mcp`, { clientId: 'cid', callbackPort: port }),
      {
        store,
      },
    )
    const url = new URL(started.authorizationUrl ?? 'http://missing.invalid')
    expect(url.searchParams.get('redirect_uri')).toBe(`http://localhost:${port}/callback`)

    const state = url.searchParams.get('state') ?? ''
    const page = await fetch(`http://127.0.0.1:${port}/callback?code=the-code&state=${state}`)
    expect(page.status).toBe(200)
    const exchange = hits.find((h) => h.path === '/token')
    expect(new URLSearchParams(exchange?.body).get('code')).toBe('the-code')
    expect(new URLSearchParams(exchange?.body).get('redirect_uri')).toBe(
      `http://localhost:${port}/callback`,
    )
    expect((await store.get('u', 'claude-code:project:api'))?.tokens?.access_token).toBe('granted')
    // The listener is gone once the sign-in ends.
    expect(fetch(`http://127.0.0.1:${port}/callback?code=x&state=y`)).rejects.toThrow()
  })

  test('a callback with an unknown state is refused by the listener', async () => {
    const { base } = authServer()
    const port = await freePort()
    await startMcpOAuth(record(`${base}/mcp`, { clientId: 'cid', callbackPort: port }), {
      store: stores(),
    })
    const page = await fetch(`http://127.0.0.1:${port}/callback?code=c&state=forged`)
    expect(page.status).toBe(400)
  })

  test('a port that is taken says so instead of starting a sign-in nobody can finish', async () => {
    const { base } = authServer()
    const taken = Bun.serve({ port: 0, hostname: '127.0.0.1', fetch: () => new Response('') })
    running.push(taken)
    await expect(
      startMcpOAuth(record(`${base}/mcp`, { clientId: 'cid', callbackPort: taken.port }), {
        store: stores(),
      }),
    ).rejects.toThrow(new RegExp(String(taken.port)))
  })
})
