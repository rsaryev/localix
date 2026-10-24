import { describe, expect, test } from 'bun:test'
import { Hono } from 'hono'

import type { AppContext } from '../../app'
import { ConflictError } from '../../lib/domain-errors'
import { createStoreRoutes } from './routes'
import { createStoreService } from './service'
import { fakeProvider, makeListing } from './testing/fake-provider'

const chess = makeListing({ id: 'chess', featured: true, contents: { screen: 1 } })
const kanban = makeListing({
  id: 'kanban',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})

function app() {
  const apps = fakeProvider('mini-app', [chess, kanban], {
    sources: [
      {
        kind: 'mini-app',
        id: 'https://hosted.test/c.json',
        label: 'Localix',
        url: 'https://hosted.test/c.json',
        builtIn: true,
        count: 2,
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
  root.route('/rpc/store', createStoreRoutes(createStoreService({ providers: [apps.provider] })))
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
})
