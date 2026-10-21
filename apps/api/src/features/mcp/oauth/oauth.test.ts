import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { makeTempDir } from '@localixai/testing'

import { createAesCipher } from '../../secrets/cipher'
import { createMcpOAuthProvider } from './provider'
import { createMcpOAuthStore } from './store'

const TMP = makeTempDir('localix-mcp-oauth')
afterAll(() => rm(TMP, { recursive: true, force: true }))

function encStore(sub: string) {
  // Deterministic 32-byte key so the encrypt path is exercised without a keyfile.
  return createMcpOAuthStore({
    dir: path.join(TMP, sub),
    cipher: createAesCipher(Buffer.alloc(32, 7)),
  })
}

const TOKENS = { access_token: 'a1', token_type: 'bearer', refresh_token: 'r1' }

describe('McpOAuthStore', () => {
  test('roundtrips tokens + clientInfo + codeVerifier (encrypted)', async () => {
    const store = encStore('rt')
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', codeVerifier: 'ver' })
    const got = await store.get('u1', 's1')
    expect(got?.tokens?.access_token).toBe('a1')
    expect(got?.codeVerifier).toBe('ver')
    expect(await store.hasTokens('u1', 's1')).toBe(true)
  })

  test('a URL change invalidates stored credentials', async () => {
    const store = encStore('url')
    await store.update('u1', 's1', { serverUrl: 'https://old/mcp', tokens: TOKENS })
    await store.update('u1', 's1', { serverUrl: 'https://new/mcp' })
    const got = await store.get('u1', 's1')
    expect(got?.serverUrl).toBe('https://new/mcp')
    expect(got?.tokens).toBeUndefined()
    expect(await store.hasTokens('u1', 's1')).toBe(false)
  })

  test('clear removes an entry; missing entry is undefined', async () => {
    const store = encStore('clr')
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    await store.clear('u1', 's1')
    expect(await store.get('u1', 's1')).toBeUndefined()
    expect(await store.get('u1', 'nope')).toBeUndefined()
  })

  test('users are isolated', async () => {
    const store = encStore('iso')
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    expect(await store.hasTokens('u2', 's1')).toBe(false)
  })

  test('a corrupt credential file is never overwritten as an empty store', async () => {
    const dir = path.join(TMP, 'corrupt-file')
    const file = path.join(dir, 'u1.json')
    const corrupt = '{"s1":'
    await mkdir(dir, { recursive: true })
    await writeFile(file, corrupt)

    const store = encStore('corrupt-file')
    let updateError: unknown
    try {
      await store.update('u1', 's2', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    } catch (error) {
      updateError = error
    }
    expect(updateError).toBeInstanceOf(Error)
    expect(await readFile(file, 'utf8')).toBe(corrupt)
  })
})

describe('createMcpOAuthProvider', () => {
  test('clientMetadata reflects redirect + auth method', () => {
    const store = encStore('meta')
    const noSecret = createMcpOAuthProvider({
      store,
      userId: 'u',
      serverId: 's',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:5051/rpc/mcp/oauth/callback',
      state: 'st',
    })
    expect(noSecret.clientMetadata.redirect_uris).toEqual([
      'http://127.0.0.1:5051/rpc/mcp/oauth/callback',
    ])
    expect(noSecret.clientMetadata.token_endpoint_auth_method).toBe('none')

    const withSecret = createMcpOAuthProvider({
      store,
      userId: 'u',
      serverId: 's',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:5051/rpc/mcp/oauth/callback',
      state: 'st',
      clientId: 'cid',
      clientSecret: 'sec',
      scope: 'read',
    })
    expect(withSecret.clientMetadata.token_endpoint_auth_method).toBe('client_secret_post')
    expect(withSecret.clientMetadata.scope).toBe('read')
  })

  test('saveTokens persists and drops the code verifier; onRedirect captures the URL', async () => {
    const store = encStore('prov')
    let captured: string | undefined
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u',
      serverId: 's',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:5051/cb',
      state: 'st',
      onRedirect: (u) => {
        captured = u.toString()
      },
    })
    await provider.saveCodeVerifier('verifier')
    expect(await provider.codeVerifier()).toBe('verifier')
    await provider.saveTokens(TOKENS)
    expect((await provider.tokens())?.access_token).toBe('a1')
    // verifier cleared after token exchange → codeVerifier() now throws
    expect(provider.codeVerifier()).rejects.toThrow()
    await provider.redirectToAuthorization(new URL('https://auth/authorize?x=1'))
    expect(captured).toBe('https://auth/authorize?x=1')
  })

  test('pre-registered clientId short-circuits clientInformation', async () => {
    const store = encStore('cid')
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u',
      serverId: 's',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:5051/cb',
      state: 'st',
      clientId: 'cid',
      clientSecret: 'sec',
    })
    expect(await provider.clientInformation()).toEqual({ client_id: 'cid', client_secret: 'sec' })
  })
})

describe('concurrent updates for different servers do not clobber each other', () => {
  // Not a synthetic race: client-manager acquires every enabled server through one
  // Promise.all, and each OAuth connect can call saveTokens/saveClientInformation —
  // all landing on the SAME per-user file. Read-whole-map → change one row →
  // write-whole-map, interleaved, silently reverts the first server's refreshed token
  // to its old value: the user re-runs the browser flow for a token that had worked.
  test('two servers refreshing at once both survive', async () => {
    const store = encStore('concurrent')
    await store.update('u', 'A', {
      serverUrl: 'https://a',
      tokens: { ...TOKENS, access_token: 'old-a' },
    })
    await store.update('u', 'B', {
      serverUrl: 'https://b',
      tokens: { ...TOKENS, access_token: 'old-b' },
    })

    await Promise.all([
      store.update('u', 'A', {
        serverUrl: 'https://a',
        tokens: { ...TOKENS, access_token: 'new-a' },
      }),
      store.update('u', 'B', {
        serverUrl: 'https://b',
        tokens: { ...TOKENS, access_token: 'new-b' },
      }),
    ])

    expect((await store.get('u', 'A'))?.tokens?.access_token).toBe('new-a')
    expect((await store.get('u', 'B'))?.tokens?.access_token).toBe('new-b')
  })

  test('a clear racing another server update does not resurrect or erase it', async () => {
    const store = encStore('concurrent-clear')
    await store.update('u', 'A', { serverUrl: 'https://a', tokens: TOKENS })
    await store.update('u', 'B', { serverUrl: 'https://b', tokens: TOKENS })

    await Promise.all([
      store.clear('u', 'A'),
      store.update('u', 'B', { serverUrl: 'https://b', tokens: { ...TOKENS, access_token: 'b2' } }),
    ])

    expect(await store.get('u', 'A')).toBeUndefined()
    expect((await store.get('u', 'B'))?.tokens?.access_token).toBe('b2')
  })
})

/**
 * MCP credentials live in their own AES store, not the vault, so none of them ever reached the
 * exposure shield's `remember` — its three feeders are plugin config, `resolveSecret`, and provider
 * connections. A server that echoes its own bearer token in a tool result or an error was therefore
 * persisted into the transcript and streamed verbatim, whatever its length.
 */
describe('every MCP OAuth secret is handed to the shield observer', () => {
  const providerWith = (seen: string[], opts: Record<string, unknown> = {}) =>
    createMcpOAuthProvider({
      store: encStore(`observe-${seen.length}-${Object.keys(opts).join('')}`),
      userId: 'u1',
      serverId: 's1',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:1/cb',
      state: 'st',
      onSecretResolved: (value) => seen.push(value),
      ...opts,
    })

  test('a pre-registered client secret is registered at construction', () => {
    const seen: string[] = []
    providerWith(seen, { clientId: 'cid', clientSecret: 'cs-abcdefghijkl' })
    expect(seen).toEqual(['cs-abcdefghijkl'])
  })

  test('both halves of a stored token pair are registered on READ', async () => {
    const seen: string[] = []
    const store = encStore('observe-read')
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u1',
      serverId: 's1',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:1/cb',
      state: 'st',
      onSecretResolved: (value) => seen.push(value),
    })
    await provider.tokens()
    expect([...seen].sort()).toEqual(['a1', 'r1'])
  })

  test('a REFRESHED pair is registered on WRITE, before the next read', async () => {
    // The lesson the provider-connections fix established: the pair a refresh writes is the one in
    // use from that moment on, so waiting for the next read leaves the live token unregistered.
    const seen: string[] = []
    const store = encStore('observe-write')
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u1',
      serverId: 's1',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:1/cb',
      state: 'st',
      onSecretResolved: (value) => seen.push(value),
    })
    await provider.saveTokens({
      access_token: 'fresh-at',
      token_type: 'bearer',
      refresh_token: 'fresh-rt',
    })
    expect([...new Set(seen)].sort()).toEqual(['fresh-at', 'fresh-rt'])
  })

  test('a dynamically registered client secret is registered both ways', async () => {
    const seen: string[] = []
    const store = encStore('observe-client')
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u1',
      serverId: 's1',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:1/cb',
      state: 'st',
      onSecretResolved: (value) => seen.push(value),
    })
    await provider.saveClientInformation!({
      client_id: 'cid',
      client_secret: 'dyn-secret-abc',
      redirect_uris: ['http://127.0.0.1:1/cb'],
    } as never)
    seen.length = 0
    await provider.clientInformation()
    expect(seen).toEqual(['dyn-secret-abc'])
  })

  test('with no observer the provider behaves exactly as before', async () => {
    const store = encStore('observe-none')
    await store.update('u1', 's1', { serverUrl: 'https://x/mcp', tokens: TOKENS })
    const provider = createMcpOAuthProvider({
      store,
      userId: 'u1',
      serverId: 's1',
      serverUrl: 'https://x/mcp',
      redirectUrl: 'http://127.0.0.1:1/cb',
      state: 'st',
    })
    expect(await provider.tokens()).toMatchObject({ access_token: 'a1' })
  })
})
