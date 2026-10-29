import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { ConflictError } from '../../lib/domain-errors'
import { createStoreRoutes } from './routes'
import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'

const atlas = makeListing({ id: 'atlas', featured: true, tags: ['game'], contents: { screen: 1 } })
const tasks = makeListing({
  id: 'tasks',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})

function app() {
  const apps = fakeProvider('mini-app', [atlas, tasks], {
    projectInstalls: {
      p1: { atlas: [{ scope: 'project', version: '2.0.0', enabled: true }] },
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
    const response = await get('/listings?shelf=discover&q=atl')
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.listings.map((listing: { ref: { id: string } }) => listing.ref.id)).toEqual([
      'atlas',
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
    expect(games.map((listing: { ref: { id: string } }) => listing.ref.id)).toEqual(['atlas'])
    expect((await get('/listings?category=Gadgets')).status).toBe(400)
  })

  test('a project install names the project it is for', async () => {
    const { apps, post } = app()
    const seen: unknown[] = []
    apps.provider.update = async (_id, scope, actor) => void seen.push([scope, actor.projectId])
    await post('/mini-app/tasks/update', { scope: 'project', projectId: 'p1' })
    expect(seen).toEqual([['project', 'p1']])
  })

  test('Discover in one read: its rows and every listing they name', async () => {
    const body = await (await app().get('/discover')).json()
    expect('hero' in body).toBe(false)
    expect(body.rows.map((row: { id: string }) => row.id)).toContain('kind:mini-app')
    expect(body.listings).toHaveLength(2)
    expect(body.updates).toEqual({ count: 1 })
  })

  test('who opens a file: every kind that opens files is asked, and a path is required', async () => {
    const { root, apps } = app()
    apps.provider.openers = async (path) => (path.endsWith('.docx') ? [atlas] : [])
    const plugins = fakeProvider('plugin', [])
    root.route('/rpc/both', createStoreRoutes(makeStore([apps.provider, plugins.provider]).store))
    const answer = await root.request('/rpc/both/openers?path=%2Fwork%2Freport.docx')
    expect(answer.status).toBe(200)
    expect((await answer.json()).listings.map((l: { ref: { id: string } }) => l.ref.id)).toEqual([
      'atlas',
    ])
    const none = await root.request('/rpc/both/openers?path=%2Fwork%2Fnotes.txt')
    expect((await none.json()).listings).toEqual([])
    expect((await root.request('/rpc/both/openers')).status).toBe(400)
  })

  test('a shelf that does not exist is a bad request', async () => {
    expect((await app().get('/listings?shelf=package:gadget')).status).toBe(400)
  })

  test('a listing’s page and its plan', async () => {
    const { get, post } = app()
    const detail = await get('/mini-app/atlas')
    expect(detail.status).toBe(200)
    expect((await detail.json()).media).toHaveLength(2)
    const plan = await post('/mini-app/atlas/plan', { scope: 'user' })
    expect(plan.status).toBe(200)
    expect((await plan.json()).warnings).toEqual(['plan for atlas'])
    expect((await get('/skill/atlas')).status).toBe(404)
    expect((await get('/gadget/atlas')).status).toBe(400)
  })

  test('install is queued (202) and a provider’s refusal keeps its status and code', async () => {
    const { apps, post } = app()
    const refused = await post('/mini-app/atlas/install', { scope: 'user' })
    expect(refused.status).toBe(409)
    expect((await refused.json()).error.code).toBe('mini_app_unverified')
    const queued = await post('/mini-app/atlas/install', { consent: { plan: true } })
    expect(queued.status).toBe(202)
    expect(apps.calls).toContain('install atlas user')
  })

  test('update is queued; remove and enable answer 204', async () => {
    const { apps, post } = app()
    expect((await post('/mini-app/tasks/update', {})).status).toBe(202)
    expect((await post('/mini-app/tasks/remove', { scope: 'user' })).status).toBe(204)
    expect((await post('/mini-app/tasks/enable', { enabled: false })).status).toBe(204)
    expect(apps.calls.slice(-3)).toEqual([
      'update tasks user',
      'remove tasks user',
      'enable tasks user false',
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
    const read = await (await get('/mini-app/atlas/config?scope=project&projectId=p1')).json()
    expect(read.values).toEqual({ url: 'atlas@project:p1' })
    const write = await post('/mini-app/atlas/config', {
      scope: 'project',
      projectId: 'p1',
      values: { url: 'https://x.test', tags: ['a'] },
    })
    expect(write.status).toBe(204)
    expect(saved).toEqual([['atlas', 'project', { url: 'https://x.test', tags: ['a'] }, 'p1']])
  })

  test('a kind without settings says so, and a listing with none answers 404', async () => {
    const { apps, get, post } = app()
    expect((await post('/mini-app/atlas/config', { values: {} })).status).toBe(409)
    apps.provider.config = async () => null
    expect((await get('/mini-app/atlas/config')).status).toBe(404)
  })

  test('the Project shelf is the open project’s own files: another project never sees them', async () => {
    const mine = makeListing({ id: 'deploy', kind: 'skill', authored: 'project' })
    const other = makeListing({ id: 'lint', kind: 'skill', authored: 'project' })
    const skills = fakeProvider('skill', [], { projectListings: { p1: [mine], p2: [other] } })
    const root = new Hono<AppContext>()
    root.use('*', async (c, next) => {
      c.set('userId', 'u1')
      await next()
    })
    root.route('/rpc/store', createStoreRoutes(makeStore([skills.provider]).store))
    const read = async (query: string) =>
      (await root.request(`/rpc/store/listings?${query}`)).json() as Promise<{
        listings: Array<{ ref: { id: string } }>
        facets: { shelves: Record<string, number> }
      }>
    const first = await read('shelf=project&projectId=p1')
    expect(first.listings.map((l) => l.ref.id)).toEqual(['deploy'])
    expect(first.facets.shelves.project).toBe(1)
    expect((await read('shelf=project&projectId=p2')).listings.map((l) => l.ref.id)).toEqual([
      'lint',
    ])
    expect((await read('shelf=project')).listings).toEqual([])
    expect((await read('projectId=p1')).facets.shelves.project).toBe(1)
    expect((await read('')).facets.shelves.project).toBeUndefined()
  })

  test('a kind that can make its own items offers a form and creates one from it', async () => {
    const { apps, get, post } = app()
    expect(await (await get('/create')).json()).toEqual({ kinds: [] })
    expect((await get('/create/mini-app')).status).toBe(409)
    const made: unknown[] = []
    apps.provider.createFields = async () => ({
      noun: 'atlas set',
      scopes: ['user', 'project'],
      fields: [{ key: 'name', label: 'Name', type: 'string', required: true, secret: false }],
    })
    apps.provider.create = async (scope, values, actor) => {
      made.push([scope, values, actor.projectId])
      return { kind: 'mini-app', id: values.name as string }
    }
    expect(await (await get('/create')).json()).toEqual({ kinds: ['mini-app'] })
    expect((await (await get('/create/mini-app')).json()).noun).toBe('atlas set')
    const response = await post('/create/mini-app', {
      scope: 'project',
      projectId: 'p1',
      values: { name: 'blitz' },
    })
    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({ ref: { kind: 'mini-app', id: 'blitz' } })
    expect(made).toEqual([['project', { name: 'blitz' }, 'p1']])
  })

  test('an install’s own actions run through its provider, and a kind without them says so', async () => {
    const { apps, post } = app()
    const body = { scope: 'user', action: 'test' }
    expect((await post('/mini-app/atlas/action', body)).status).toBe(409)
    apps.provider.runAction = async (id, scope, action) => ({
      ok: true,
      message: `${action} ${id} ${scope}`,
    })
    const response = await post('/mini-app/atlas/action', body)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, message: 'test atlas user' })
  })

  test('a shelf action is previewed, then run on the items the person confirmed', async () => {
    const { apps, get, post } = app()
    expect(await (await get('/shelf-actions')).json()).toEqual({ actions: [] })
    expect((await post('/shelf/mini-app/plan', { scope: 'user', action: 'tidy' })).status).toBe(409)
    const ran: unknown[] = []
    apps.provider.shelfActions = async (scope) =>
      scope === 'user' ? [{ id: 'tidy', label: 'Tidy up' }] : []
    apps.provider.planShelfAction = async (action, scope) => ({
      summary: `${action} on ${scope}`,
      items: [{ ref: { kind: 'mini-app', id: 'atlas' }, name: 'atlas', reason: 'idle' }],
    })
    apps.provider.runShelfAction = async (action, scope, ids, actor) => {
      ran.push([action, scope, ids, actor.projectId])
      return { ok: true, message: 'done' }
    }
    expect(await (await get('/shelf-actions?scope=user')).json()).toEqual({
      actions: [{ kind: 'mini-app', id: 'tidy', label: 'Tidy up' }],
    })
    expect(await (await get('/shelf-actions?scope=project&projectId=p1')).json()).toEqual({
      actions: [],
    })
    const plan = await post('/shelf/mini-app/plan', { scope: 'user', action: 'tidy' })
    expect((await plan.json()).items).toHaveLength(1)
    const run = await post('/shelf/mini-app/run', {
      scope: 'project',
      projectId: 'p1',
      action: 'tidy',
      ids: ['atlas'],
    })
    expect(await run.json()).toEqual({ ok: true, message: 'done' })
    expect(ran).toEqual([['tidy', 'project', ['atlas'], 'p1']])
  })

  test('activity and Update all', async () => {
    const { get, post } = app()
    const activity = await (await get('/activity')).json()
    expect(activity.updates).toEqual([
      {
        ref: { kind: 'mini-app', id: 'tasks' },
        displayName: 'tasks',
        from: '1.0.0',
        to: '1.1.0',
      },
    ])
    const applied = await post('/updates/apply')
    expect(applied.status).toBe(202)
    expect(await applied.json()).toEqual({ queued: [{ kind: 'mini-app', id: 'tasks' }] })
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
    await get('/mini-app/atlas?projectId=p1')
    expect(seen).toEqual(['p1'])
    const page = await (await get('/listings?projectId=p1')).json()
    const atlasOf = (body: { listings: Array<{ ref: { id: string }; installs: unknown[] }> }) =>
      body.listings.find((listing) => listing.ref.id === 'atlas')
    expect(atlasOf(page)?.installs).toEqual([{ scope: 'project', version: '2.0.0', enabled: true }])
    const installed = await (await get('/listings?shelf=installed&projectId=p1')).json()
    expect(installed.listings.map((l: { ref: { id: string } }) => l.ref.id).sort()).toEqual([
      'atlas',
      'tasks',
    ])
    const elsewhere = await (await get('/listings?shelf=installed')).json()
    expect(elsewhere.listings.map((l: { ref: { id: string } }) => l.ref.id)).toEqual(['tasks'])
  })
})
