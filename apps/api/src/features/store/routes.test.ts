import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { ConflictError } from '../../lib/domain-errors'
import { createStoreRoutes } from './routes'
import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'

const chess = makeListing({ id: 'chess', featured: true, contents: { screen: 1 } })
const kanban = makeListing({
  id: 'kanban',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})

function app() {
  const apps = fakeProvider('mini-app', [chess, kanban], {
    projectInstalls: {
      p1: { chess: [{ scope: 'project', version: '2.0.0', enabled: true }] },
    },
    sources: [
      {
        kind: 'mini-app',
        id: 'https://hosted.test/catalog.json',
        label: 'Localix',
        url: 'https://hosted.test/c.json',
        builtIn: true,
        count: 2,
      },
      {
        kind: 'mini-app',
        id: 'https://gone.test/c.json',
        label: 'Gone',
        url: 'https://gone.test/c.json',
        builtIn: false,
        count: 0,
        problem: 'The catalog answered 404',
      },
    ],
  })
  const unverified = new ConflictError('mini_app_unverified', 'confirm to install it')
  apps.provider.install = async (id, scope, consent) => {
    if (!consent.plan) throw unverified
    apps.calls.push(`install ${id} ${scope}`)
  }
  const root = new Hono<AppContext>()
  root.use('*', async (c, next) => {
    c.set('userId', 'u1')
    await next()
  })
  root.route('/rpc/store', createStoreRoutes(makeStore([apps.provider]).store))
  const post = (path: string, body?: unknown) =>
    root.request(`/rpc/store${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  return { root, apps, post, get: (path: string) => root.request(`/rpc/store${path}`) }
}

describe('/rpc/store', () => {
  test('a page of listings for a shelf and a search, with the facets', async () => {
    const { get } = app()
    const response = await get('/listings?shelf=discover&q=che')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.listings.map((listing: { ref: { id: string } }) => listing.ref.id)).toEqual([
      'chess',
    ])
    expect(body.facets.shelves).toMatchObject({ discover: 1, 'package:mini-app': 2, updates: 1 })
    expect((await (await get('/listings?installed=true')).json()).listings).toHaveLength(1)
  })

  test('a page ends with where the next starts; filters and the project travel with it', async () => {
    const { get } = app()
    const first = await (await get('/listings?limit=1&projectId=p1')).json()
    expect(first.listings).toHaveLength(1)
    const second = await (await get(`/listings?limit=1&cursor=${first.nextCursor}`)).json()
    expect(second.listings[0].ref.id).not.toBe(first.listings[0].ref.id)
    const games = (await (await get('/listings?category=Games')).json()).listings
    expect(games.map((listing: { ref: { id: string } }) => listing.ref.id)).toEqual(['chess'])
    expect((await get('/listings?category=Gadgets')).status).toBe(400)
  })

  test('a project install names the project it is for', async () => {
    const { apps, post } = app()
    const seen: unknown[] = []
    apps.provider.update = async (_id, scope, actor) => void seen.push([scope, actor.projectId])
    await post('/mini-app/kanban/update', { scope: 'project', projectId: 'p1' })
    expect(seen).toEqual([['project', 'p1']])
  })

  test('Discover in one read: its rows and every listing they name', async () => {
    const body = await (await app().get('/discover')).json()
    expect(body.hero).toBeNull()
    expect(body.rows.map((row: { id: string }) => row.id)).toContain('kind:mini-app')
    expect(body.listings).toHaveLength(2)
    expect(body.updates).toEqual({ count: 1 })
  })

  test('a shelf that does not exist is a bad request', async () => {
    expect((await app().get('/listings?shelf=package:gadget')).status).toBe(400)
  })

  test('a listing’s page and its plan', async () => {
    const { get, post } = app()
    const detail = await get('/mini-app/chess')
    expect(detail.status).toBe(200)
    expect((await detail.json()).media).toHaveLength(2)
    const plan = await post('/mini-app/chess/plan', { scope: 'user' })
    expect(plan.status).toBe(200)
    expect((await plan.json()).warnings).toEqual(['plan for chess'])
    expect((await get('/skill/chess')).status).toBe(404)
    expect((await get('/gadget/chess')).status).toBe(400)
  })

  test('install is queued (202) and a provider’s refusal keeps its status and code', async () => {
    const { apps, post } = app()
    const refused = await post('/mini-app/chess/install', { scope: 'user' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.code).toBe('mini_app_unverified')
    const queued = await post('/mini-app/chess/install', { consent: { plan: true } })
    expect(queued.status).toBe(202)
    expect(apps.calls).toContain('install chess user')
  })

  test('update is queued; remove and enable answer 204', async () => {
    const { apps, post } = app()
    expect((await post('/mini-app/kanban/update', {})).status).toBe(202)
    expect((await post('/mini-app/kanban/remove', { scope: 'user' })).status).toBe(204)
    expect((await post('/mini-app/kanban/enable', { enabled: false })).status).toBe(204)
    expect(apps.calls.slice(-3)).toEqual([
      'update kanban user',
      'remove kanban user',
      'enable kanban user false',
    ])
  })

  test('sources: listed, previewed, added and removed by kind', async () => {
    const { apps, get, post } = app()
    expect((await (await get('/sources')).json()).sources[0].label).toBe('Localix')
    const preview = await post('/sources/preview', { kind: 'mini-app', input: 'https://ada.test' })
    expect((await preview.json()).publishers).toEqual(['Ada'])
    expect(
      (await post('/sources/add', { kind: 'mini-app', input: 'https://ada.test' })).status,
    ).toBe(204)
    expect(
      (await post('/sources/remove', { kind: 'mini-app', id: 'https://ada.test' })).status,
    ).toBe(204)
    expect(apps.calls).toContain('remove source https://ada.test')
  })

  test('an install’s settings are read and saved through its provider, per scope', async () => {
    const { apps, get, post } = app()
    const saved: unknown[] = []
    apps.provider.config = async (id, scope, actor) => ({
      fields: [{ key: 'url', label: 'URL', type: 'string', required: false, secret: false }],
      values: { url: `${id}@${scope}:${actor.projectId ?? '-'}` },
      set: [],
      scope,
      scopes: ['user', 'project'],
    })
    apps.provider.setConfig = async (id, scope, values, actor) =>
      void saved.push([id, scope, values, actor.projectId])
    const read = await (await get('/mini-app/chess/config?scope=project&projectId=p1')).json()
    expect(read.values).toEqual({ url: 'chess@project:p1' })
    const write = await post('/mini-app/chess/config', {
      scope: 'project',
      projectId: 'p1',
      values: { url: 'https://x.test', tags: ['a'] },
    })
    expect(write.status).toBe(204)
    expect(saved).toEqual([['chess', 'project', { url: 'https://x.test', tags: ['a'] }, 'p1']])
  })

  test('a kind without settings says so, and a listing with none answers 404', async () => {
    const { apps, get, post } = app()
    expect((await post('/mini-app/chess/config', { values: {} })).status).toBe(409)
    apps.provider.config = async () => null
    expect((await get('/mini-app/chess/config')).status).toBe(404)
  })

  test('activity and Update all', async () => {
    const { get, post } = app()
    const activity = await (await get('/activity')).json()
    expect(activity.updates).toEqual([
      {
        ref: { kind: 'mini-app', id: 'kanban' },
        displayName: 'kanban',
        from: '1.0.0',
        to: '1.1.0',
      },
    ])
    const applied = await post('/updates/apply')
    expect(applied.status).toBe(202)
    expect(await applied.json()).toEqual({ queued: [{ kind: 'mini-app', id: 'kanban' }] })
  })

  test('sources say when they were read, what went wrong and which kinds can add one', async () => {
    const { get } = app()
    await get('/listings')
    const body = await (await get('/sources')).json()
    expect(body.addable).toEqual(['mini-app'])
    const [hosted, gone] = body.sources
    expect(hosted.syncedAt).toBe('2026-10-25T00:00:00.000Z')
    expect(hosted.problem).toBeUndefined()
    expect(gone.problem).toBe('The catalog answered 404')
  })

  test('one source is read again, and its auto-update switched', async () => {
    const { apps, post } = app()
    const id = 'https://hosted.test/c.json'
    expect((await post('/sources/refresh', { kind: 'mini-app', id })).status).toBe(204)
    const switched = await post('/sources/auto-update', { kind: 'mini-app', id, autoUpdate: false })
    expect(switched.status).toBe(204)
    expect(apps.calls).toContain(`refresh source ${id}`)
    expect(apps.calls).toContain(`auto-update ${id} false`)
    expect((await post('/sources/refresh', { kind: 'plugin', id })).status).toBe(404)
  })

  test('a listing’s page and a page of listings show the open project’s installs', async () => {
    const { apps, get } = app()
    const seen: unknown[] = []
    const provider = apps.provider
    const detail = provider.detail.bind(provider)
    provider.detail = async (id, actor) => (seen.push(actor.projectId), detail(id, actor))
    await get('/mini-app/chess?projectId=p1')
    expect(seen).toEqual(['p1'])
    const page = await (await get('/listings?projectId=p1')).json()
    const chessOf = (body: { listings: Array<{ ref: { id: string }; installs: unknown[] }> }) =>
      body.listings.find((listing) => listing.ref.id === 'chess')
    expect(chessOf(page)?.installs).toEqual([{ scope: 'project', version: '2.0.0', enabled: true }])
    const installed = await (await get('/listings?shelf=installed&projectId=p1')).json()
    expect(installed.listings.map((l: { ref: { id: string } }) => l.ref.id).sort()).toEqual([
      'chess',
      'kanban',
    ])
    const elsewhere = await (await get('/listings?shelf=installed')).json()
    expect(elsewhere.listings.map((l: { ref: { id: string } }) => l.ref.id)).toEqual(['kanban'])
  })
})
