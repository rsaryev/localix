import { describe, it, expect, afterEach } from 'bun:test'
import { stubFetch, fetchBody } from '../../testing/fetch-stub'
import type { ManifestOAuthSpec } from '@localixai/plugin-sdk/backend'

import { makePluginOAuth } from './oauth'

const PORT = 21000 + Math.floor(Math.random() * 2000)

function spec(port: number): ManifestOAuthSpec {
  return {
    loginLabel: 'Connect Test',
    callbackMode: 'local-server',
    localServer: { host: '127.0.0.1', port, path: '/callback' },
    authorize: {
      url: 'https://auth.example/authorize',
      clientId: 'client-1',
      scopes: ['read', 'write'],
    },
    token: { url: 'https://auth.example/token', format: 'form' },
    refresh: {},
  }
}

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

/** Stub the token endpoint; passes loopback-callback fetches through. */
function stubTokenEndpoint(handler: (url: string, init?: RequestInit) => Response | undefined) {
  globalThis.fetch = stubFetch(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const stubbed = handler(url, init)
    if (stubbed) return stubbed
    return realFetch(input as never, init)
  })
}

describe('ctx.oauth', () => {
  it('refuses a callback listener outside loopback', () => {
    const oauth = makePluginOAuth('spotify')
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'example.com']) {
      const exposed = { ...spec(PORT), localServer: { host, port: PORT, path: '/callback' } }
      expect(() => oauth.beginLogin(exposed)).toThrow('localServer.host must be a loopback address')
    }
  })

  it('beginLogin builds a PKCE authorize URL and completes via the loopback callback', async () => {
    const port = PORT
    let tokenBody = ''
    stubTokenEndpoint((url, init) => {
      if (!url.startsWith('https://auth.example/token')) return undefined
      tokenBody = fetchBody(init)
      return Response.json({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600 })
    })

    const oauth = makePluginOAuth('spotify')
    const login = oauth.beginLogin(spec(port))
    try {
      const u = new URL(login.authorizeUrl)
      expect(u.origin + u.pathname).toBe('https://auth.example/authorize')
      expect(u.searchParams.get('client_id')).toBe('client-1')
      expect(u.searchParams.get('code_challenge_method')).toBe('S256')
      // The engine honors the declared loopback host verbatim (exact-match providers).
      expect(u.searchParams.get('redirect_uri')).toBe(`http://127.0.0.1:${port}/callback`)
      expect(u.searchParams.get('scope')).toBe('read write')
      const state = u.searchParams.get('state')!
      expect(state.length).toBeGreaterThan(10)

      // Simulate the provider redirecting the browser to the loopback callback.
      const cb = await realFetch(`http://127.0.0.1:${port}/callback?code=abc&state=${state}`)
      expect(cb.status).toBe(200)
      expect(await cb.text()).toContain('Connected')

      const cred = await login.credential
      expect(cred.accessToken).toBe('at-1')
      expect(cred.refreshToken).toBe('rt-1')
      expect(cred.expiresAt).toBeGreaterThan(Date.now())
      // The exchange carried the code + PKCE verifier.
      expect(tokenBody).toContain('code=abc')
      expect(tokenBody).toContain('code_verifier=')
    } finally {
      login.cancel()
    }
  })

  it('rejects a callback with a mismatched state (CSRF) and keeps waiting', async () => {
    const port = PORT + 1
    const oauth = makePluginOAuth('p')
    const login = oauth.beginLogin(spec(port))
    try {
      const bad = await realFetch(`http://127.0.0.1:${port}/callback?code=abc&state=WRONG`)
      expect(bad.status).toBe(400)
      // Still pending — the one-shot server wasn't consumed by the forged request.
      const pending = await Promise.race([
        login.credential.then(() => 'done'),
        Promise.resolve('pending'),
      ])
      expect(pending).toBe('pending')
    } finally {
      login.cancel()
    }
  })

  it('rejects when the provider returns error= (user denied)', async () => {
    const port = PORT + 2
    const oauth = makePluginOAuth('p')
    const login = oauth.beginLogin(spec(port))
    const state = new URL(login.authorizeUrl).searchParams.get('state')!
    await realFetch(`http://127.0.0.1:${port}/callback?error=access_denied&state=${state}`)
    expect(login.credential).rejects.toThrow('access_denied')
  })

  it('cancel() stops the loopback server and rejects the credential', async () => {
    const port = PORT + 3
    const oauth = makePluginOAuth('p')
    const login = oauth.beginLogin(spec(port))
    login.cancel()
    expect(login.credential).rejects.toThrow('cancelled')
    const dead = await realFetch(`http://127.0.0.1:${port}/callback?code=x&state=y`).catch(
      () => null,
    )
    expect(dead).toBeNull()
  })

  it('beginLogin requires a local-server spec', () => {
    const oauth = makePluginOAuth('p')
    const bad = { ...spec(PORT + 4), callbackMode: 'app-redirect' as const, localServer: undefined }
    expect(() => oauth.beginLogin(bad)).toThrow('local-server')
  })

  it('refresh() round-trips through the spec refresh config', async () => {
    stubTokenEndpoint((url, init) => {
      if (!url.startsWith('https://auth.example/token')) return undefined
      const body = fetchBody(init)
      if (!body.includes('grant_type=refresh_token') || !body.includes('refresh_token=rt-1')) {
        return Response.json({ error: 'bad refresh' }, { status: 400 })
      }
      return Response.json({ access_token: 'at-2', expires_in: 3600 })
    })
    const oauth = makePluginOAuth('p')
    const cred = await oauth.refresh(spec(PORT + 5), 'rt-1')
    expect(cred.accessToken).toBe('at-2')
  })
})
