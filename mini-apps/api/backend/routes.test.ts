/**
 * The routes, exercised through Hono's own `app.request()` — no server, no port.
 *
 * The claims worth testing here are the boundary ones: the wire never carries a literal
 * credential, ownership is per-user, and a failure names a code the UI can branch on.
 */

import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { MiniAppRouteContext, MiniAppRouteScope } from '@localixai/mini-app-sdk/backend'
import { createRestRoutes } from './routes'
import { createMemoryCollection } from './collection/testing/memory'
import type { EnvironmentService } from './environments/service'
import { createEnvironmentService, type EnvironmentStore } from './environments/testing/service'
import type { SavedEnvironment } from './environments/store'
import { listHistory, recordSend, resetHistory } from './history'

// See history.test.ts: the ring is process-wide, so a suite that records must clear it.
afterAll(resetHistory)
import type { EnvironmentsResponse, SendResponse } from './contracts'
import type { RequestSpec } from './request-spec'
import type { CollectionRequest, CollectionStore } from './collection/store'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.github.com/users/octocat',
  method: 'GET',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

const saved = (name: string, over: Partial<RequestSpec> = {}): CollectionRequest => ({
  name,
  createdAt: 1,
  updatedAt: 2,
  spec: spec(over),
})

/**
 * The collection these routes read. One shared in-memory double (see collection/testing/memory.ts) — the
 * real filesystem store is pinned in its own suite, and a temp directory per case here would be
 * slower without making a status code any truer.
 */
function stubStore(seed: Record<string, CollectionRequest[]> = {}) {
  const flat = Object.values(seed).flat()
  const store = createMemoryCollection(flat.map((r) => ({ name: r.name, spec: r.spec })))
  /** What is actually on disk, in name order — the collection has no user dimension to key on. */
  const stored = () => [...store.records.values()].sort((a, b) => a.name.localeCompare(b.name))
  return { store, stored }
}

/** An environment service with nothing in it — most route tests use no variables. */
const noEnvironments: EnvironmentService = {
  list: async () => [],
  get: async () => null,
  save: async () => {
    throw new Error('not used')
  },
  use: async () => null,
  deactivate: async () => {},
  remove: async () => false,
  rename: async () => null,
  activeVars: async () => new Map(),
  activeName: async () => null,
}

/**
 * Mount the routes as the host does and pass the SDK request scope as Hono bindings.
 */
function harness(
  store: CollectionStore,
  userId = 'user-a',
  environments = noEnvironments,
  /** The vault WRITER. Absent by default, which is the "no vault bound" half of the contract. */
  storeSecret?: (userId: string, key: string, value: string) => Promise<boolean>,
) {
  const app = new Hono<MiniAppRouteContext>()
  app.route(
    '/rpc/api',
    createRestRoutes({
      collection: () => store,
      environments,
      resolveSecret: async () => 'RESOLVED_SECRET',
      ...(storeSecret ? { storeSecret } : {}),
      send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
    }),
  )
  const callAs = (callerUserId: string, path: string, init?: RequestInit, cwd = '') =>
    app.request(`/rpc/api${path}`, init, {
      userId: callerUserId,
      projectId: '',
      cwd,
    } satisfies MiniAppRouteScope)
  const call = (path: string, init?: RequestInit) => callAs(userId, path, init)
  return { call, callAs }
}

describe('GET /requests', () => {
  test('lists the caller’s saved requests', async () => {
    const { store } = stubStore({ 'user-a': [saved('github-user'), saved('stripe-charge')] })
    const res = await harness(store).call('/requests')
    expect(res.status).toBe(200)
    const body = (await res.json()) as { requests: { name: string }[] }
    expect(body.requests.map((r) => r.name)).toEqual(['github-user', 'stripe-charge'])
  })

  test('lists NOTHING from another PROJECT — the collection is a directory, one per project', async () => {
    // This used to be a cross-USER claim. The store was a per-user file; it is now a directory
    // inside the project, so the isolation that exists (and the one worth pinning) is by
    // project. `userId` was never an authenticated dimension anyway — see the safe-file-key
    // contract, which reads that precondition out of `app.ts`.
    const alpha = createMemoryCollection([{ name: 'alpha-only', spec: saved('alpha-only').spec }])
    const beta = createMemoryCollection([{ name: 'beta-only', spec: saved('beta-only').spec }])
    const app = new Hono<MiniAppRouteContext>()
    app.route(
      '/rpc/api',
      createRestRoutes({
        collection: (cwd) => (cwd === '/repos/alpha' ? alpha : beta),
        environments: noEnvironments,
        resolveSecret: async () => 'RESOLVED_SECRET',
        send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
      }),
    )
    const inAlpha = await app.request(
      '/rpc/api/requests',
      {},
      { userId: 'user-a', projectId: 'alpha', cwd: '/repos/alpha' },
    )
    const listed = (await inAlpha.json()) as { requests: { name: string }[] }
    expect(listed.requests.map((r) => r.name)).toEqual(['alpha-only'])
  })

  test('two sessions in one project receive different request collections', async () => {
    const alpha = createMemoryCollection([{ name: 'alpha-only', spec: saved('alpha-only').spec }])
    const beta = createMemoryCollection([{ name: 'beta-only', spec: saved('beta-only').spec }])
    const app = new Hono<MiniAppRouteContext>()
    app.route(
      '/rpc/api',
      createRestRoutes({
        collection: (_cwd, sessionId) => (sessionId === 'session-a' ? alpha : beta),
        environments: noEnvironments,
        resolveSecret: async () => 'RESOLVED_SECRET',
        send: { timeoutMs: 1000, maxBodyBytes: 1000, allowPrivateNetwork: false },
      }),
    )
    const list = async (sessionId: string) => {
      const response = await app.request(
        '/rpc/api/requests',
        {},
        {
          userId: 'user-a',
          sessionId,
          projectId: 'same-project',
          cwd: '/repos/shared',
        },
      )
      return ((await response.json()) as { requests: { name: string }[] }).requests.map(
        (request) => request.name,
      )
    }
    expect(await list('session-a')).toEqual(['alpha-only'])
    expect(await list('session-b')).toEqual(['beta-only'])
  })

  test('no saved requests is an empty list, not a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests')
    expect(res.status).toBe(200)
  })
})

describe('collection folders', () => {
  test('creates and lists an empty folder', async () => {
    const { store } = stubStore()
    const h = harness(store)
    const created = await h.call('/folders', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'users/admin' }),
    })
    expect(created.status).toBe(201)
    expect(await created.json()).toEqual({ folder: 'users/admin' })

    const listed = (await (await h.call('/folders')).json()) as { folders: string[] }
    expect(listed.folders).toEqual(['users', 'users/admin'])
  })

  test('only an empty folder can be deleted', async () => {
    const { store } = stubStore({ 'user-a': [saved('users/list')] })
    const h = harness(store)
    const refused = await h.call(`/folders/${encodeURIComponent('users')}`, { method: 'DELETE' })
    expect(refused.status).toBe(422)
    expect(await store.get('users/list')).not.toBeNull()
  })
})

describe('the wire never carries a literal credential', () => {
  test('a literal bearer token is redacted out of the list', async () => {
    const { store } = stubStore({
      'user-a': [saved('gh', { auth: { type: 'bearer', token: 'ghp_SUPERSECRET' } })],
    })
    const text = await (await harness(store).call('/requests')).text()
    expect(text).not.toContain('ghp_SUPERSECRET')
    expect(text).toContain('bearer')
  })

  test('a literal basic password is redacted out of a single get', async () => {
    const { store } = stubStore({
      'user-a': [saved('gh', { auth: { type: 'basic', username: 'ada', password: 'hunter2' } })],
    })
    const text = await (await harness(store).call('/requests/gh')).text()
    expect(text).not.toContain('hunter2')
  })

  test('a ${secret:KEY} reference DOES reach the UI — it is a pointer, not a secret', async () => {
    const { store } = stubStore({
      'user-a': [saved('gh', { auth: { type: 'bearer', token: '${secret:GH_TOKEN}' } })],
    })
    const text = await (await harness(store).call('/requests')).text()
    expect(text).toContain('${secret:GH_TOKEN}')
  })
})

describe('GET /requests/:name', () => {
  test('returns the request', async () => {
    const { store } = stubStore({ 'user-a': [saved('github-user')] })
    const res = await harness(store).call('/requests/github-user')
    expect(res.status).toBe(200)
    expect((await res.json()).request.name).toBe('github-user')
  })

  test('an unknown name is a 404 with a code the UI can branch on', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests/nope')
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('request_not_found')
  })

  test('a name needing encoding round-trips', async () => {
    const { store } = stubStore({ 'user-a': [saved('weird/name')] })
    const res = await harness(store).call(`/requests/${encodeURIComponent('weird/name')}`)
    expect(res.status).toBe(200)
  })
})

describe('DELETE /requests/:name', () => {
  test('removes the request', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('gh')] })
    const res = await harness(store).call('/requests/gh', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(stored()).toEqual([])
  })

  test('deleting an unknown name is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests/nope', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('POST /requests/:name/send', () => {
  test('an unknown name is a 404 — nothing is sent', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests/nope/send', { method: 'POST' })
    expect(res.status).toBe(404)
  })

  test('a blocked private target is a 403 with `blocked` — refused, not failed', async () => {
    // The guard is the point: a request the user saved may still name an internal host, and the
    // UI must be able to tell "we refused" from "the network broke".
    const { store } = stubStore({
      'user-a': [saved('internal', { url: 'http://169.254.169.254/' })],
    })
    const res = await harness(store).call('/requests/internal/send', { method: 'POST' })
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')
  })
})

describe('the UI Send renders variables exactly as the agent’s does', () => {
  /** An environment service with `base_url` defined. */
  const withVars = (vars: Record<string, string>): EnvironmentService => ({
    ...noEnvironments,
    activeVars: async () => new Map(Object.entries(vars)),
    activeName: async () => 'staging',
  })

  test('a request naming an UNDEFINED variable is refused, not sent at `{{base_url}}`', async () => {
    const { store } = stubStore({ 'user-a': [saved('templated', { url: '{{base_url}}/users' })] })
    const res = await harness(store, 'user-a', noEnvironments).call('/requests/templated/send', {
      method: 'POST',
    })
    expect(res.status).toBe(400)
    const body = (await res.json()) as { code: string; detail?: string }
    expect(body.code).toBe('bad_request')
    // The message must name the variable — it is the whole actionable content.
    expect(body.detail ?? '').toContain('base_url')
  })

  test('a defined variable renders and the request is attempted against the REAL host', async () => {
    const { store } = stubStore({
      'user-a': [saved('templated', { url: '{{base_url}}/users' })],
    })
    const res = await harness(store, 'user-a', withVars({ base_url: 'http://127.0.0.1' })).call(
      '/requests/templated/send',
      { method: 'POST' },
    )
    // 403 `blocked` proves the render happened: the SSRF guard saw a loopback host, which only
    // exists in the environment — the saved url has no host at all.
    expect(res.status).toBe(403)
    expect((await res.json()).code).toBe('blocked')
  })
})

describe('environments are reachable from the UI', () => {
  const envService = (rows: { name: string; active: boolean }[]): EnvironmentService => {
    const list = rows.map((r) => ({
      id: r.name,
      createdAt: 0,
      updatedAt: 0,
      active: r.active,
      variables: [{ name: 'base_url', value: `https://${r.name}.dev` }],
    }))
    return {
      ...noEnvironments,
      list: async () => list,
      get: async (_u, n) => list.find((e) => e.id === n) ?? null,
      use: async (_u, n) => {
        const target = list.find((e) => e.id === n)
        if (!target) return null
        for (const e of list) e.active = e.id === n
        return target
      },
      activeVars: async () => {
        const active = list.find((e) => e.active)
        return new Map(active ? [['base_url', `https://${active.id}.dev`]] : [])
      },
      activeName: async () => list.find((e) => e.active)?.id ?? null,
    }
  }

  test('GET /environments lists them and says which is active', async () => {
    const { store } = stubStore()
    const res = await harness(
      store,
      'user-a',
      envService([
        { name: 'dev', active: false },
        { name: 'prod', active: true },
      ]),
    ).call('/environments')
    expect(res.status).toBe(200)
    const body = (await res.json()) as EnvironmentsResponse
    expect(body.environments).toEqual([
      { name: 'dev', active: false, variables: [{ name: 'base_url', value: 'https://dev.dev' }] },
      { name: 'prod', active: true, variables: [{ name: 'base_url', value: 'https://prod.dev' }] },
    ])
  })

  test('POST /environments/:name/use switches the active one', async () => {
    const { store } = stubStore()
    const envs = envService([
      { name: 'dev', active: true },
      { name: 'prod', active: false },
    ])
    const h = harness(store, 'user-a', envs)
    expect((await h.call('/environments/prod/use', { method: 'POST' })).status).toBe(200)
    expect(await envs.activeName('user-a')).toBe('prod')
  })

  test('using an unknown environment is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store, 'user-a', envService([])).call('/environments/nope/use', {
      method: 'POST',
    })
    expect(res.status).toBe(404)
  })
})

describe('GET /requests/:name resolves the template', () => {
  const withBase = (host: string | null): EnvironmentService => ({
    ...noEnvironments,
    activeVars: async () => new Map(host ? [['base_url', host]] : []),
    activeName: async () => (host ? 'staging' : null),
  })

  test('a templated request carries what it resolves to RIGHT NOW', async () => {
    // Computed on the read, not cached: the active environment changes under an open tab, and a
    // stale preview would name a destination the request no longer has.
    const { store } = stubStore({ 'user-a': [saved('t', { url: '{{base_url}}/users' })] })
    const res = await harness(store, 'user-a', withBase('https://staging.dev')).call('/requests/t')
    const body = (await res.json()) as {
      request: unknown
      resolved?: { url: string; environment: string }
    }
    expect(body.resolved?.url).toBe('https://staging.dev/users')
    expect(body.resolved?.environment).toBe('staging')
  })

  test('the SAVED spec still holds the template — the request stays portable', async () => {
    const { store } = stubStore({ 'user-a': [saved('t', { url: '{{base_url}}/users' })] })
    const res = await harness(store, 'user-a', withBase('https://staging.dev')).call('/requests/t')
    const body = (await res.json()) as { request: { spec: { url: string } } }
    expect(body.request.spec.url).toBe('{{base_url}}/users')
  })

  test('an unresolvable variable is NAMED rather than silently blanked', async () => {
    const { store } = stubStore({ 'user-a': [saved('t', { url: '{{base_url}}/users' })] })
    const res = await harness(store, 'user-a', withBase(null)).call('/requests/t')
    const body = (await res.json()) as { resolved?: { missing: string[]; environment: null } }
    expect(body.resolved?.missing).toEqual(['base_url'])
    expect(body.resolved?.environment).toBeNull()
  })

  test('a request with NO variables carries no preview — there is nothing to resolve', async () => {
    const { store } = stubStore({ 'user-a': [saved('plain')] })
    const res = await harness(store, 'user-a', withBase('https://staging.dev')).call(
      '/requests/plain',
    )
    expect((await res.json()).resolved).toBeUndefined()
  })
})

describe('PUT /requests/:name — editing, and what it refuses', () => {
  const edit = (over: Record<string, unknown> = {}) => ({
    url: 'https://api.github.com/user',
    method: 'GET',
    headers: [],
    query: [],
    ...over,
  })
  const put = (
    h: ReturnType<typeof harness>,
    name: string,
    body: unknown,
    ct = 'application/json',
  ) =>
    h.call(`/requests/${name}`, {
      method: 'PUT',
      headers: { 'content-type': ct },
      body: JSON.stringify(body),
    })

  test('it edits the request', async () => {
    const { store } = stubStore({ 'user-a': [saved('gh')] })
    const res = await put(
      harness(store),
      'gh',
      edit({ url: 'https://api.github.com/octocat', method: 'POST' }),
    )
    expect(res.status).toBe(200)
    const body = (await res.json()) as { request: { spec: { url: string; method: string } } }
    expect(body.request.spec.url).toBe('https://api.github.com/octocat')
    expect(body.request.spec.method).toBe('POST')
  })

  test('a templated url is allowed — it is not a url until an environment renders it', async () => {
    const { store } = stubStore({ 'user-a': [saved('gh')] })
    expect((await put(harness(store), 'gh', edit({ url: '{{base_url}}/users' }))).status).toBe(200)
  })

  test('a non-http literal url is refused', async () => {
    const { store } = stubStore({ 'user-a': [saved('gh')] })
    const res = await put(harness(store), 'gh', edit({ url: 'api.github.com' }))
    expect(res.status).toBe(400)
  })

  test('editing an unknown request is a 404', async () => {
    const { store } = stubStore()
    expect((await put(harness(store), 'nope', edit())).status).toBe(404)
  })
})

describe('the edit route cannot be turned into a credential exfiltrator', () => {
  // THE ATTACK it is shaped against: a hostile page rewrites a request that carries a vaulted
  // credential so it points at the attacker's host, triggers a send, and the vault pays. The
  // attacker never reads a response — the token lands in their own logs, so CORS does not help.
  const vaulted = () => saved('gh-me', { auth: { type: 'bearer', token: '${secret:GH_TOKEN}' } })

  test('auth CANNOT be set from the wire — it is not in the schema', async () => {
    const { store, stored } = stubStore({ 'user-a': [vaulted()] })
    const res = await harness(store).call('/requests/gh-me', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: 'https://evil.example/steal',
        method: 'GET',
        headers: [],
        query: [],
        auth: { type: 'bearer', token: '${secret:OTHER_KEY}' },
      }),
    })
    expect(res.status).toBe(200)
    // The url changed (that is an edit), but auth is the STORED one — a browser cannot re-point a
    // credential at a different key.
    expect(stored()[0].spec.auth).toEqual({
      type: 'bearer',
      token: '${secret:GH_TOKEN}',
    })
  })

  test('a SIMPLE-request payload never reaches the handler', async () => {
    // A cross-origin POST/PUT with `text/plain` skips preflight and IS delivered by every browser.
    // `zValidator('json')` refuses it; a handler calling `c.req.json()` directly would not —
    // measured, not assumed. This test is what keeps that from being "simplified" away.
    const { store, stored } = stubStore({ 'user-a': [vaulted()] })
    const res = await harness(store).call('/requests/gh-me', {
      method: 'PUT',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ url: 'https://evil.example', method: 'GET', headers: [], query: [] }),
    })
    expect(res.status).not.toBe(200)
    expect(stored()[0].spec.url).toBe('https://api.github.com/users/octocat')
  })

  test.each(['application/x-www-form-urlencoded', 'multipart/form-data', 'text/plain'])(
    'content-type %p is refused',
    async (ct) => {
      const { store, stored } = stubStore({ 'user-a': [vaulted()] })
      const res = await harness(store).call('/requests/gh-me', {
        method: 'PUT',
        headers: { 'content-type': ct },
        body: JSON.stringify({
          url: 'https://evil.example',
          method: 'GET',
          headers: [],
          query: [],
        }),
      })
      expect(res.status).not.toBe(200)
      expect(stored()[0].spec.url).not.toContain('evil')
    },
  )
})

describe('a PUT REPLACES — an omitted field is gone, not quietly kept', () => {
  // The bug: `...(edit.body?.text?.trim() ? {body} : {})` spread over `...existing.spec` meant a
  // cleared body was RETAINED. The PUT returned 200, the tab said "saved", and the next Send
  // transmitted the payload the user believed they had deleted. A save that lies.
  const withBoth = () =>
    saved('p', {
      method: 'POST',
      pathParameters: [{ name: 'id', value: '1' }],
      body: { mimeType: 'application/json', text: '{"drop":true}' },
    })
  const edit = (over: Record<string, unknown> = {}) => ({
    url: 'https://api.github.com/users/octocat',
    method: 'POST',
    headers: [],
    query: [],
    ...over,
  })
  const put = (h: ReturnType<typeof harness>, body: unknown) =>
    h.call('/requests/p', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('clearing the body REMOVES it', async () => {
    const { store, stored } = stubStore({ 'user-a': [withBoth()] })
    // Exactly what the tab sends once the textarea is empty.
    const res = await put(
      harness(store),
      edit({ body: { mimeType: 'application/json', text: '' } }),
    )
    expect(res.status).toBe(200)
    expect(stored()[0].spec.body).toBeUndefined()
  })

  test('omitting the body entirely removes it', async () => {
    const { store, stored } = stubStore({ 'user-a': [withBoth()] })
    await put(harness(store), edit())
    expect(stored()[0].spec.body).toBeUndefined()
  })

  test('emptying the path-param rows REMOVES them', async () => {
    const { store, stored } = stubStore({ 'user-a': [withBoth()] })
    await put(harness(store), edit({ pathParameters: [] }))
    expect(stored()[0].spec.pathParameters).toBeUndefined()
  })

  test('a body that IS sent still lands', async () => {
    const { store, stored } = stubStore({ 'user-a': [withBoth()] })
    await put(harness(store), edit({ body: { mimeType: 'application/json', text: '{"kept":1}' } }))
    expect(stored()[0].spec.body?.text).toBe('{"kept":1}')
  })

  test('a FORM body survives an edit that only touches the url', async () => {
    // The bug hiding inside the bug: the draft carried only `text`, so a form body came back as
    // `text: undefined` — and it survived ONLY because the spread-when-truthy never replaced it.
    // Making the PUT honest would have destroyed it, so `form` is part of the contract now.
    const form = [{ name: 'a', value: '1' }]
    const { store, stored } = stubStore({
      'user-a': [
        saved('p', {
          method: 'POST',
          body: { mimeType: 'application/x-www-form-urlencoded', form },
        }),
      ],
    })
    await put(
      harness(store),
      edit({
        url: 'https://api.dev/moved',
        body: { mimeType: 'application/x-www-form-urlencoded', form },
      }),
    )
    expect(stored()[0].spec.body?.form).toEqual(form)
    expect(stored()[0].spec.url).toBe('https://api.dev/moved')
  })

  test('auth is STILL kept from the stored record — replace does not mean clobber', async () => {
    const { store, stored } = stubStore({
      'user-a': [saved('p', { auth: { type: 'bearer', token: '${secret:GH}' } })],
    })
    await put(harness(store), edit())
    expect(stored()[0].spec.auth).toEqual({ type: 'bearer', token: '${secret:GH}' })
  })
})

describe('POST /requests (manual create)', () => {
  const create = (h: ReturnType<typeof harness>, body: unknown) =>
    h.call('/requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })

  test('mints a blank request — name only, defaults GET', async () => {
    const { store, stored } = stubStore()
    const res = await create(harness(store), { name: 'fresh' })
    expect(res.status).toBe(201)
    const row = stored()[0]
    expect(row.name).toBe('fresh')
    expect(row.spec.method).toBe('GET')
    expect(row.spec.url).toBe('')
    expect(row.spec.auth).toEqual({ type: 'none' })
  })

  test('a taken name is a 409 name_taken, not an overwrite', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('mine')] })
    const res = await create(harness(store), { name: 'mine' })
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('name_taken')
    expect(stored()[0].spec.url).toBe('https://api.github.com/users/octocat')
  })

  test('a non-http literal url is refused; a template is not', async () => {
    const { store } = stubStore()
    expect((await create(harness(store), { name: 'a', url: 'ftp://x' })).status).toBe(400)
    expect((await create(harness(store), { name: 'b', url: '{{base_url}}/x' })).status).toBe(201)
  })

  test('a blank name is a 400', async () => {
    const { store } = stubStore()
    expect((await create(harness(store), { name: '  ' })).status).toBe(400)
  })
})

describe('POST /requests/:name/rename', () => {
  const rename = (h: ReturnType<typeof harness>, name: string, to: string) =>
    h.call(`/requests/${name}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ to }),
    })

  test('renames in place — the spec survives the move', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('old-name')] })
    const res = await rename(harness(store), 'old-name', 'new-name')
    expect(res.status).toBe(200)
    const rows = stored()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('new-name')
    expect(rows[0].spec.url).toBe('https://api.github.com/users/octocat')
    // `createdAt` deliberately does NOT survive: a rename is a file MOVE, and the stamp is the
    // filesystem's `birthtime`, not a field inside the JSON. Writing one into the file would be
    // one more thing a `git pull` or an edit in the user's editor could make wrong.
  })

  test('renaming onto an existing name is a 409 and destroys nothing', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('a'), saved('b')] })
    const res = await rename(harness(store), 'a', 'b')
    expect(res.status).toBe(409)
    expect(stored().map((r) => r.name)).toEqual(['a', 'b'])
  })

  test('a missing request is a 404', async () => {
    const { store } = stubStore()
    expect((await rename(harness(store), 'ghost', 'x')).status).toBe(404)
  })
})

describe('POST /requests/:name/duplicate', () => {
  test('copies the WHOLE spec (auth included) under name-copy', async () => {
    const { store, stored } = stubStore({
      'user-a': [saved('mine', { auth: { type: 'bearer', token: '${secret:GH}' } })],
    })
    const res = await harness(store).call('/requests/mine/duplicate', { method: 'POST' })
    expect(res.status).toBe(201)
    const rows = stored()
    expect(rows.map((r) => r.name)).toEqual(['mine', 'mine-copy'])
    expect(rows[1].spec.auth).toEqual({ type: 'bearer', token: '${secret:GH}' })
    // The WIRE view of the copy is still redacted — the server-side copy is the point.
    const body = (await res.json()) as { request: { spec: { auth: { token?: string } } } }
    expect(body.request.spec.auth.token).toBe('${secret:GH}')
  })

  test('the second copy numbers itself', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('mine'), saved('mine-copy')] })
    await harness(store).call('/requests/mine/duplicate', { method: 'POST' })
    expect(stored().map((r) => r.name)).toEqual(['mine', 'mine-copy', 'mine-copy-2'])
  })
})

describe('GET /requests/:name/history', () => {
  test('a request never sent has an empty history, not an error', async () => {
    const { store } = stubStore({ 'user-a': [saved('mine')] })
    const res = await harness(store).call('/requests/mine/history')
    expect(res.status).toBe(200)
    expect(((await res.json()) as { entries: unknown[] }).entries).toEqual([])
  })
})

describe('PUT /requests/:name/auth (editable auth)', () => {
  const setAuth = (h: ReturnType<typeof harness>, name: string, auth: unknown) =>
    h.call(`/requests/${name}/auth`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ auth }),
    })

  test('a typed literal is vaulted, and the wire shows the REFERENCE it became', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('r')] })
    // With a vault present the literal is MOVED there and only the reference is stored — the
    // collection lives in the repo and refuses a literal outright, so this is the path that
    // makes typing a token into the editor work at all.
    const vaulted = new Map<string, string>()
    const res = await setAuth(
      harness(store, 'user-a', noEnvironments, async (_u, key, value) => {
        if (vaulted.has(key)) return false
        vaulted.set(key, value)
        return true
      }),
      'r',
      { type: 'bearer', token: 'sk-literal' },
    )
    expect(res.status).toBe(200)
    expect([...vaulted.values()]).toEqual(['sk-literal'])
    // What LANDS is the reference, never the literal: the collection is a directory in the repo,
    // and git history is forever. This is the whole reason the auth route vaults first.
    expect(stored()[0].spec.auth).toEqual({ type: 'bearer', token: '${secret:REST_R_TOKEN}' })
    // And the wire shows the POINTER, not a mask. `redactSpec`'s rule, unchanged: a reference is
    // not a secret, and seeing it is how the user learns which key their token went into — which
    // is exactly what they need to rotate it later, or to share the request with a colleague.
    const body = (await res.json()) as { request: { spec: { auth: { token?: string } } } }
    expect(body.request.spec.auth.token).toBe('${secret:REST_R_TOKEN}')
  })

  test('a masked token keeps the stored secret (browser never clobbers what it could not read)', async () => {
    const { store, stored } = stubStore({
      'user-a': [saved('r', { auth: { type: 'bearer', token: 'sk-real' } })],
    })
    await setAuth(harness(store), 'r', { type: 'bearer', token: '••••••' })
    expect(stored()[0].spec.auth).toEqual({ type: 'bearer', token: 'sk-real' })
  })

  test('a ${secret:KEY} reference reads through un-redacted on the wire', async () => {
    const { store } = stubStore({ 'user-a': [saved('r')] })
    const res = await setAuth(harness(store), 'r', { type: 'bearer', token: '${secret:GH}' })
    const body = (await res.json()) as { request: { spec: { auth: { token?: string } } } }
    expect(body.request.spec.auth.token).toBe('${secret:GH}')
  })

  test('a missing request is a 404', async () => {
    const { store } = stubStore()
    expect((await setAuth(harness(store), 'ghost', { type: 'none' })).status).toBe(404)
  })

  test('an unknown auth type is rejected by the schema (400)', async () => {
    const { store } = stubStore({ 'user-a': [saved('r')] })
    expect((await setAuth(harness(store), 'r', { type: 'oauth9' })).status).toBe(400)
  })
})

/** An in-memory environment store, wrapped by the REAL service so the invariants under test hold. */
function stubEnvStore(seed: Record<string, SavedEnvironment[]> = {}) {
  const byUser = new Map<string, SavedEnvironment[]>(Object.entries(seed))
  const rows = (u: string) => byUser.get(u) ?? []
  const store: EnvironmentStore = {
    list: async (u) => [...rows(u)],
    get: async (u, id) => rows(u).find((r) => r.id === id) ?? null,
    create: async (u, e) => {
      const list = rows(u)
      const at = list.findIndex((r) => r.id === e.id)
      if (at === -1) list.push(e)
      else list[at] = e
      byUser.set(u, list)
    },
    updateById: async (u, id, patch) => {
      const list = rows(u)
      const at = list.findIndex((r) => r.id === id)
      if (at === -1) return null
      list[at] = { ...list[at], ...patch } as SavedEnvironment
      byUser.set(u, list)
      return list[at]
    },
    remove: async (u, id) => {
      byUser.set(
        u,
        rows(u).filter((r) => r.id !== id),
      )
    },
  }
  const stored = (u = 'user-a') => byUser.get(u) ?? []
  return { store, byUser, stored, service: createEnvironmentService(store) }
}

const json = (body: unknown, method = 'POST') => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('POST /environments (create)', () => {
  test('resolves user identity from every request instead of capturing the boot user', async () => {
    const { store } = stubStore()
    const env = stubEnvStore()
    const h = harness(store, 'boot-user', env.service)

    expect(
      (await h.callAs('user-a', '/environments', json({ name: 'alpha', variables: [] }))).status,
    ).toBe(201)
    expect((await h.callAs('user-b', '/environments')).status).toBe(200)
    expect(env.stored('user-a').map((item) => item.id)).toEqual(['alpha'])
    expect(env.stored('user-b')).toEqual([])
  })

  test('mints an environment; the FIRST one is active', async () => {
    const { store } = stubStore()
    const env = stubEnvStore()
    const res = await harness(store, 'user-a', env.service).call(
      '/environments',
      json({ name: 'staging', variables: [{ name: 'base_url', value: 'https://staging.dev' }] }),
    )
    expect(res.status).toBe(201)
    const body = (await res.json()) as { environment: { name: string; active: boolean } }
    expect(body.environment.name).toBe('staging')
    expect(body.environment.active).toBe(true)
  })

  test('a taken name is a 409 name_taken, not an overwrite', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({
      'user-a': [{ id: 'dev', createdAt: 1, updatedAt: 1, active: true, variables: [] }],
    })
    const res = await harness(store, 'user-a', env.service).call(
      '/environments',
      json({ name: 'dev', variables: [] }),
    )
    expect(res.status).toBe(409)
    expect(((await res.json()) as { code: string }).code).toBe('name_taken')
  })

  test('a blank name is a 400', async () => {
    const { store } = stubStore()
    const res = await harness(store, 'user-a', stubEnvStore().service).call(
      '/environments',
      json({ name: '   ', variables: [] }),
    )
    expect(res.status).toBe(400)
  })

  test('a native-Vault reference is accepted as an environment secret', async () => {
    const { store } = stubStore()
    const env = stubEnvStore()
    const res = await harness(store, 'user-a', env.service).call(
      '/environments',
      json({ name: 'e', variables: [{ name: 'token', value: '${secret:GH}', secret: true }] }),
    )
    expect(res.status).toBe(201)
    expect(env.stored()[0]?.variables).toEqual([
      { name: 'token', value: '${secret:GH}', secret: true },
    ])
  })
})

describe('PUT /environments/:name (replace variables)', () => {
  test('REPLACES the variable list wholesale, keeping active + createdAt', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({
      'user-a': [
        {
          id: 'dev',
          createdAt: 111,
          updatedAt: 111,
          active: true,
          variables: [{ name: 'old', value: 'x' }],
        },
      ],
    })
    const res = await harness(store, 'user-a', env.service).call('/environments/dev', {
      ...json({ variables: [{ name: 'base_url', value: 'https://new.dev' }] }),
      method: 'PUT',
    })
    expect(res.status).toBe(200)
    const row = env.stored()[0]
    expect(row.variables).toEqual([{ name: 'base_url', value: 'https://new.dev' }])
    expect(row.active).toBe(true)
    expect(row.createdAt).toBe(111)
  })

  test('editing an unknown environment is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store, 'user-a', stubEnvStore().service).call('/environments/nope', {
      ...json({ variables: [] }),
      method: 'PUT',
    })
    expect(res.status).toBe(404)
  })

  test('a ${secret:…} value can replace the secret rows on edit', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({
      'user-a': [{ id: 'dev', createdAt: 1, updatedAt: 1, active: true, variables: [] }],
    })
    const res = await harness(store, 'user-a', env.service).call('/environments/dev', {
      ...json({ variables: [{ name: 'k', value: '${secret:X}', secret: true }] }),
      method: 'PUT',
    })
    expect(res.status).toBe(200)
    expect(env.stored()[0]?.variables).toEqual([{ name: 'k', value: '${secret:X}', secret: true }])
  })
})

describe('environment rename and duplicate lifecycle', () => {
  const dev = (): SavedEnvironment => ({
    id: 'dev',
    createdAt: 1,
    updatedAt: 1,
    active: true,
    variables: [{ name: 'token', value: '${secret:SHARED}', secret: true }],
  })

  test('rename preserves variables and the active state', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({ 'user-a': [dev()] })
    const response = await harness(store, 'user-a', env.service).call(
      '/environments/dev/rename',
      json({ to: 'local' }),
    )

    expect(response.status).toBe(200)
    expect(env.stored().map((item) => item.id)).toEqual(['local'])
    expect(env.stored()[0]?.active).toBe(true)
    expect(env.stored()[0]?.variables).toEqual(dev().variables)
  })

  test('rename onto an existing environment is a 409 and changes nothing', async () => {
    const { store } = stubStore()
    const prod = { ...dev(), id: 'prod', active: false }
    const env = stubEnvStore({ 'user-a': [dev(), prod] })
    const response = await harness(store, 'user-a', env.service).call(
      '/environments/dev/rename',
      json({ to: 'prod' }),
    )

    expect(response.status).toBe(409)
    expect(env.stored().map((item) => item.id)).toEqual(['dev', 'prod'])
  })

  test('duplicate keeps Vault references and does not steal the active pointer', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({ 'user-a': [dev()] })
    const api = harness(store, 'user-a', env.service)

    expect((await api.call('/environments/dev/duplicate', { method: 'POST' })).status).toBe(201)
    expect((await api.call('/environments/dev/duplicate', { method: 'POST' })).status).toBe(201)

    expect(env.stored().map((item) => item.id)).toEqual(['dev', 'dev-copy', 'dev-copy-2'])
    expect(
      env
        .stored()
        .filter((item) => item.active)
        .map((item) => item.id),
    ).toEqual(['dev'])
    expect(env.stored()[1]?.variables).toEqual(dev().variables)
  })

  test('rename and duplicate of an unknown environment are 404s', async () => {
    const { store } = stubStore()
    const api = harness(store, 'user-a', stubEnvStore().service)
    expect((await api.call('/environments/ghost/rename', json({ to: 'x' }))).status).toBe(404)
    expect((await api.call('/environments/ghost/duplicate', { method: 'POST' })).status).toBe(404)
  })
})

describe('DELETE /environments/:name', () => {
  test('removes it', async () => {
    const { store } = stubStore()
    const env = stubEnvStore({
      'user-a': [{ id: 'dev', createdAt: 1, updatedAt: 1, active: true, variables: [] }],
    })
    const res = await harness(store, 'user-a', env.service).call('/environments/dev', {
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(env.stored()).toEqual([])
  })

  test('deleting an unknown environment is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store, 'user-a', stubEnvStore().service).call('/environments/nope', {
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

describe('POST /import', () => {
  const curl = 'curl https://api.dev/users'

  test('previews without saving — nothing lands in the store', async () => {
    const { store, stored } = stubStore()
    const res = await harness(store).call('/import', json({ source: curl }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      requests: { name: string }[]
      saved: boolean
      collisions: string[]
    }
    expect(body.saved).toBe(false)
    expect(body.requests).toHaveLength(1)
    expect(body.requests[0].name).toBe('api-users')
    expect(stored() ?? []).toEqual([])
  })

  test('save=true writes the request, returned via toInfo (redacted)', async () => {
    const { store, stored } = stubStore()
    const res = await harness(store).call('/import', json({ source: curl, save: true }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { requests: { name: string }[]; saved: boolean }
    expect(body.saved).toBe(true)
    expect(stored().map((r) => r.name)).toEqual(['api-users'])
  })

  test('a name clash is reported in `collisions` and auto-suffixed', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('api-users')] })
    const res = await harness(store).call('/import', json({ source: curl, save: true }))
    const body = (await res.json()) as { collisions: string[] }
    expect(body.collisions).toContain('api-users-2')
    expect(stored().map((r) => r.name)).toEqual(['api-users', 'api-users-2'])
  })

  test('an unrecognised source is a 400 with a naming detail', async () => {
    const { store } = stubStore()
    const res = await harness(store).call(
      '/import',
      json({ source: 'hello world, not an api request' }),
    )
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('bad_request')
  })

  test('a text/plain import is refused by zValidator (the SIMPLE-request guard)', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/import', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: JSON.stringify({ source: curl, save: true }),
    })
    expect(res.status).not.toBe(200)
  })
})

describe('per-request send settings round-trip and are validated', () => {
  const put = (
    h: ReturnType<typeof harness>,
    name: string,
    body: unknown,
    ct = 'application/json',
  ) =>
    h.call(`/requests/${name}`, {
      method: 'PUT',
      headers: { 'content-type': ct },
      body: JSON.stringify(body),
    })
  const edit = (over: Record<string, unknown> = {}) => ({
    url: 'https://api.dev/x',
    method: 'GET',
    headers: [],
    query: [],
    ...over,
  })

  test('followRedirects + timeoutMs + maxRedirects round-trip', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('r')] })
    const res = await put(
      harness(store),
      'r',
      edit({ followRedirects: false, timeoutMs: 5000, maxRedirects: 3 }),
    )
    expect(res.status).toBe(200)
    const spec = stored()[0].spec
    expect(spec.followRedirects).toBe(false)
    expect(spec.timeoutMs).toBe(5000)
    expect(spec.maxRedirects).toBe(3)
  })

  test('PUT-replaces: an omitted setting is CLEARED, not kept', async () => {
    const { store, stored } = stubStore({
      'user-a': [saved('r', { followRedirects: false, timeoutMs: 9000 })],
    })
    await put(harness(store), 'r', edit()) // no settings in the payload
    const spec = stored()[0].spec
    expect(spec.followRedirects).toBeUndefined()
    expect(spec.timeoutMs).toBeUndefined()
  })

  test('a non-positive timeoutMs is rejected by the schema (400)', async () => {
    const { store } = stubStore({ 'user-a': [saved('r')] })
    expect((await put(harness(store), 'r', edit({ timeoutMs: 0 }))).status).toBe(400)
    expect((await put(harness(store), 'r', edit({ timeoutMs: -5 }))).status).toBe(400)
  })

  test('a stored non-positive timeout is refused at SEND with bad_request — before any fetch', async () => {
    // A spec from an import or an older schema could carry a bad timeout the PUT would now reject.
    // The send path must not act on it. The check fires before the fetch, so no network is touched.
    const { store } = stubStore({ 'user-a': [saved('bad', { timeoutMs: 0 })] })
    const res = await harness(store).call('/requests/bad/send', { method: 'POST' })
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('bad_request')
  })
})

describe('DELETE /requests/:name/history', () => {
  const someRes = (): SendResponse => ({
    status: 200,
    statusText: 'OK',
    url: 'https://api.dev',
    headers: {},
    body: '',
    bytes: 0,
    truncated: false,
    elapsedMs: 1,
    hops: [{ url: 'https://api.dev', status: 200, elapsedMs: 1 }],
  })

  test('clears the ring; the request itself stays', async () => {
    const { store, stored } = stubStore({ 'user-a': [saved('clear-me')] })
    recordSend('user-a', 'clear-me', someRes(), 'user')
    expect(listHistory('user-a', 'clear-me')).toHaveLength(1)
    const res = await harness(store).call('/requests/clear-me/history', { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(listHistory('user-a', 'clear-me')).toEqual([])
    expect(stored().map((r) => r.name)).toEqual(['clear-me'])
  })

  test('clearing history of an unknown request is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests/ghost/history', { method: 'DELETE' })
    expect(res.status).toBe(404)
  })
})

describe('a workbench Send records history tagged "user"', () => {
  const realFetch = globalThis.fetch
  afterEach(() => {
    globalThis.fetch = realFetch
  })

  test('the /send route labels its history row "user"', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      { preconnect: () => {} },
    )
    const { store } = stubStore({ 'user-a': [saved('send-src', { url: 'https://api.dev/ok' })] })
    const res = await harness(store).call('/requests/send-src/send', { method: 'POST' })
    expect(res.status).toBe(200)
    expect(listHistory('user-a', 'send-src')[0].source).toBe('user')
  })

  test('a reflected native-Vault secret reaches neither the UI response nor recent history', async () => {
    globalThis.fetch = Object.assign(
      async () =>
        new Response('RESOLVED_SECRET', {
          status: 200,
          headers: {
            'content-type': 'text/plain',
            'x-reflected-secret': 'RESOLVED_SECRET',
            'set-cookie': 'sid=RESOLVED_SECRET; Path=/; HttpOnly',
          },
        }),
      { preconnect: () => {} },
    )
    const { store } = stubStore({
      'user-a': [
        saved('vault-reflection', {
          url: 'https://api.dev/echo',
          auth: { type: 'bearer', token: '${secret:GH_TOKEN}' },
        }),
      ],
    })

    const response = await harness(store).call('/requests/vault-reflection/send', {
      method: 'POST',
    })
    const responseText = await response.text()
    const historyText = JSON.stringify(listHistory('user-a', 'vault-reflection'))

    expect(response.status).toBe(200)
    expect(responseText).not.toContain('RESOLVED_SECRET')
    expect(historyText).not.toContain('RESOLVED_SECRET')
    expect(responseText).toContain('REDACTED')
    expect(historyText).toContain('REDACTED')
  })
})

describe('GET /requests/:name/export', () => {
  test('exports a curl command as text/plain, masking a literal', async () => {
    const { store } = stubStore({
      'user-a': [saved('gh', { auth: { type: 'bearer', token: 'sk-literal' } })],
    })
    const res = await harness(store).call('/requests/gh/export?format=curl')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    const text = await res.text()
    expect(text).toContain('curl')
    expect(text).not.toContain('sk-literal')
    expect(text).toContain('••••••')
  })

  test('a ${secret:KEY} reference is kept verbatim in the export', async () => {
    const { store } = stubStore({
      'user-a': [saved('gh', { auth: { type: 'bearer', token: '${secret:GH}' } })],
    })
    const text = await (await harness(store).call('/requests/gh/export')).text()
    expect(text).toContain('${secret:GH}')
  })

  test('an unknown format is a 400', async () => {
    const { store } = stubStore({ 'user-a': [saved('gh')] })
    const res = await harness(store).call('/requests/gh/export?format=har')
    expect(res.status).toBe(400)
  })

  test('exporting an unknown request is a 404', async () => {
    const { store } = stubStore()
    const res = await harness(store).call('/requests/nope/export')
    expect(res.status).toBe(404)
  })
})

describe('POST /environments/deactivate', () => {
  test('clears the active flag — requests then use their literal urls', async () => {
    let cleared = false
    const envs: EnvironmentService = {
      ...noEnvironments,
      deactivate: async () => {
        cleared = true
      },
    }
    const { store } = stubStore()
    const res = await harness(store, 'user-a', envs).call('/environments/deactivate', {
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(cleared).toBe(true)
  })

  test('the literal segment wins over :name/use — no environment named "deactivate" is activated', async () => {
    // If routing matched `/:name/use` first this would 404 (no such env in the empty service).
    const { store } = stubStore()
    const res = await harness(store).call('/environments/deactivate', { method: 'POST' })
    expect(res.status).toBe(200)
  })
})
