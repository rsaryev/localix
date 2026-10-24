import { describe, expect, test } from 'bun:test'

import { createStoreService } from './service'
import { fakeProvider, makeListing } from './testing/fake-provider'

const actor = { userId: 'u1' }
const chess = makeListing({ id: 'chess', featured: true })
const kanban = makeListing({
  id: 'kanban',
  installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '1.1.0' }],
})
const review = makeListing({ id: 'review', kind: 'plugin', contents: { skill: 2 } })

function setup() {
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
  const plugins = fakeProvider('plugin', [review], { withoutOptional: true })
  const store = createStoreService({ providers: [apps.provider, plugins.provider] })
  let pokes = 0
  store.subscribe(() => pokes++)
  return { apps, plugins, store, pokes: () => pokes }
}

const ids = (page: { listings: { ref: { id: string } }[] }) => page.listings.map((l) => l.ref.id)

describe('the Store', () => {
  test('lists every provider’s packages, and reads a provider again only once it changed', async () => {
    const { apps, store, pokes } = setup()
    expect(ids(await store.listings(actor, {}))).toEqual(['chess', 'kanban', 'review'])
    expect(ids(await store.listings(actor, { shelf: 'package:plugin' }))).toEqual(['review'])
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(1)

    apps.change([chess])
    expect(pokes()).toBe(1)
    expect(ids(await store.listings(actor, {}))).toEqual(['chess', 'review'])
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(2)
  })

  test('a change announced elsewhere is read again once the Store is told', async () => {
    const { apps, store } = setup()
    await store.listings(actor, {})
    store.invalidate()
    await store.listings(actor, {})
    expect(apps.calls.filter((call) => call === 'listings')).toHaveLength(2)
  })

  test('a provider that cannot list is a problem; the others still answer', async () => {
    const broken = fakeProvider('plugin', [], { fails: 'marketplace unreachable' })
    const apps = fakeProvider('mini-app', [chess])
    const store = createStoreService({ providers: [apps.provider, broken.provider] })
    const page = await store.listings(actor, {})
    expect(ids(page)).toEqual(['chess'])
    expect(page.problems).toEqual(['marketplace unreachable'])
  })

  test('a page comes with facets over every listing', async () => {
    const { store } = setup()
    const page = await store.listings(actor, { shelf: 'updates' })
    expect(ids(page)).toEqual(['kanban'])
    expect(page.facets.kind).toEqual({ 'mini-app': 2, plugin: 1 })
    expect(page.facets.updates).toBe(1)
  })

  test('each action reaches the provider of the listing’s kind', async () => {
    const { apps, plugins, store } = setup()
    await store.install({ kind: 'mini-app', id: 'chess' }, 'user', { plan: true }, actor)
    await store.update({ kind: 'mini-app', id: 'kanban' }, 'user', actor)
    await store.remove({ kind: 'plugin', id: 'review' }, 'project', actor)
    await store.setEnabled({ kind: 'mini-app', id: 'kanban' }, 'user', false, actor)
    expect(apps.calls).toEqual([
      'install chess user true',
      'update kanban user',
      'enable kanban user false',
    ])
    expect(plugins.calls).toEqual(['remove review project'])
    expect((await store.plan({ kind: 'plugin', id: 'review' }, 'user', actor)).warnings).toEqual([
      'plan for review',
    ])
    expect((await store.detail({ kind: 'mini-app', id: 'chess' }, actor)).readme).toContain('chess')
  })

  test('a kind no provider serves, or a capability its provider lacks, is refused', async () => {
    const { store } = setup()
    await expect(store.detail({ kind: 'skill', id: 'x' }, actor)).rejects.toMatchObject({
      status: 404,
      code: 'store_kind_unknown',
    })
    await expect(
      store.setEnabled({ kind: 'plugin', id: 'review' }, 'user', true, actor),
    ).rejects.toMatchObject({ status: 409, code: 'store_unsupported' })
    await expect(store.addSource('plugin', 'https://x.test')).rejects.toMatchObject({
      code: 'store_unsupported',
    })
  })

  test('sources are listed by provider and added, previewed and removed through it', async () => {
    const { apps, store } = setup()
    expect((await store.sources()).map((source) => source.label)).toEqual(['Localix'])
    expect((await store.previewSource('mini-app', 'https://ada.test/c.json')).publishers).toEqual([
      'Ada',
    ])
    await store.addSource('mini-app', 'https://ada.test/c.json')
    await store.removeSource('mini-app', 'https://ada.test/c.json')
    expect(apps.calls).toContain('add source https://ada.test/c.json')
    expect(apps.calls).toContain('remove source https://ada.test/c.json')
  })

  test('activity: the jobs in flight and the updates offered, across kinds', async () => {
    const { apps, store } = setup()
    apps.change([
      { ...chess, job: { action: 'install', phase: 'downloading', received: 1, total: 4 } },
      kanban,
    ])
    expect(await store.activity(actor)).toEqual({
      jobs: [
        {
          ref: { kind: 'mini-app', id: 'chess' },
          displayName: 'chess',
          action: 'install',
          phase: 'downloading',
          received: 1,
          total: 4,
        },
      ],
      updates: [
        {
          ref: { kind: 'mini-app', id: 'kanban' },
          displayName: 'kanban',
          from: '1.0.0',
          to: '1.1.0',
        },
      ],
    })
  })

  test('Update all re-reads every source, then updates each install a newer version is offered for', async () => {
    const { apps, plugins, store } = setup()
    const queued = await store.applyUpdates(actor)
    expect(queued).toEqual([{ kind: 'mini-app', id: 'kanban' }])
    expect(apps.calls).toEqual(['refresh', 'listings', 'update kanban user'])
    expect(plugins.calls).toEqual(['refresh', 'listings'])
  })

  test('Update all passes over an install its provider refuses to update, and queues the rest', async () => {
    const { apps, store } = setup()
    const radio = makeListing({
      id: 'radio',
      installs: [{ scope: 'user', version: '1.0.0', enabled: true, updateTo: '2.0.0' }],
    })
    apps.change([radio, kanban])
    apps.provider.update = async (id) => {
      if (id === 'radio') throw new Error('A mini app of yours is already called "radio"')
      apps.calls.push(`update ${id}`)
    }
    expect(await store.applyUpdates(actor)).toEqual([{ kind: 'mini-app', id: 'kanban' }])
  })
})
