import { afterEach, describe, expect, test } from 'bun:test'
import type { DiscoverResponse, Listing, StoreProvider, Trust } from '@localixai/store'

import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'

const actor = { userId: 'u1' }
let opened: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})
const storeOf = (providers: StoreProvider[], opts?: Parameters<typeof makeStore>[1]) =>
  (opened = makeStore(providers, opts))

const trusted = (trust: Trust) => ({ id: trust, label: trust, trust })
const app = (id: string, over: Partial<Listing> = {}) =>
  makeListing({ id, source: trusted('localix'), summary: `${id} app`, ...over })
const plugin = (id: string, trust: Trust, over: Partial<Listing> = {}) =>
  makeListing({ id, kind: 'plugin', source: trusted(trust), summary: `${id} plugin`, ...over })

const ids = (answer: DiscoverResponse, row: string) =>
  answer.rows.find((found) => found.id === row)?.items.map((ref) => ref.id)

function setup(opts: Parameters<typeof makeStore>[1] = {}) {
  const apps = fakeProvider(
    'mini-app',
    [
      app('gallery', { recommended: true, tags: ['gallery'] }),
      app('diary', { recommended: true, updatedAt: '2026-10-20T00:00:00Z' }),
      app('atlas', { featured: true, tags: ['game'] }),
      app('compass', { tags: ['game'] }),
      app('tasks', {
        installs: [{ scope: 'user', version: '1', enabled: true, updateTo: '2' }],
      }),
    ],
    {
      editorial: [
        {
          source: 'localix',
          collections: [
            {
              id: 'play',
              title: 'Play with the agent',
              style: 'row',
              items: [
                { kind: 'mini-app', id: 'atlas' },
                { kind: 'mini-app', id: 'compass' },
                { kind: 'plugin', id: 'risky@community' },
                { kind: 'mini-app', id: 'gone' },
              ],
            },
          ],
        },
      ],
    },
  )
  const plugins = fakeProvider('plugin', [
    plugin('mini-apps@localix', 'localix', { recommended: true, tags: ['typescript'] }),
    plugin('pg@official', 'official', { category: 'database', tags: ['postgres'] }),
    plugin('risky@community', 'community', { recommended: true }),
  ])
  return storeOf([apps.provider, plugins.provider], opts).store
}

describe('Discover', () => {
  test('the collections are what an editorial source picked, and no hero comes with them', async () => {
    const answer = await setup().discover(actor, {})
    expect('hero' in answer).toBe(false)
    expect(answer.rows.find((row) => row.id === 'play')).toMatchObject({
      title: 'Play with the agent',
      style: 'row',
      // A community listing never appears in a pick, and one no source lists is left out.
      items: [
        { kind: 'mini-app', id: 'atlas' },
        { kind: 'mini-app', id: 'compass' },
      ],
    })
  })

  test('Start here mixes the kinds an editorial source recommends, never a community one', async () => {
    const answer = await setup().discover(actor, {})
    expect(ids(answer, 'start')?.sort()).toEqual(['diary', 'gallery', 'mini-apps@localix'])
  })

  test('For this project shows what suits the open project, and is left out without a match', async () => {
    expect(ids(await setup().discover(actor, {}), 'project')).toBeUndefined()
    const answer = await setup({ projectWords: ['typescript'] }).discover(actor, {
      projectId: 'p1',
    })
    expect(ids(answer, 'project')).toEqual(['mini-apps@localix'])
  })

  test('New & updated, then one row per kind by score', async () => {
    const answer = await setup().discover(actor, {})
    expect(ids(answer, 'new')).toEqual(['diary'])
    expect(answer.rows.find((row) => row.id === 'kind:mini-app')?.title).toBe('Mini apps')
    expect(ids(answer, 'kind:plugin')).toEqual([
      'mini-apps@localix',
      'pg@official',
      'risky@community',
    ])
  })

  test('the updates waiting, the categories with their counts, and every listing named', async () => {
    const answer = await setup().discover(actor, {})
    expect(answer.updates).toEqual({ count: 1 })
    expect(answer.categories).toContainEqual({ id: 'Games', label: 'Games', count: 2 })
    expect(answer.categories).toContainEqual({ id: 'Data', label: 'Data', count: 1 })
    const named = new Set(answer.rows.flatMap((row) => row.items.map((ref) => ref.id)))
    expect(new Set(answer.listings.map((listing) => listing.ref.id))).toEqual(
      new Set([...named, 'atlas']),
    )
  })

  test('a listing’s page names more from its publisher and what is like it', async () => {
    const store = setup()
    const detail = await store.detail({ kind: 'mini-app', id: 'atlas' }, actor)
    expect(detail.related?.map((ref) => ref.id)).toContain('compass')
    expect(detail.related?.map((ref) => ref.id)).not.toContain('atlas')
    expect(detail.similar?.map((ref) => ref.id)).toEqual(['compass'])
    // The rows come with the listings they name, so the page draws them without another read.
    const named = new Set([...detail.related!, ...detail.similar!].map((ref) => ref.id))
    expect(new Set(detail.linked?.map((listing) => listing.ref.id))).toEqual(named)
  })
})

describe('Discover without an editorial source', () => {
  // The hosted mini app catalog and the `localix` marketplace may answer 404 (offline, or a
  // development build whose catalog is not published): official sources still fill Discover.
  function officialOnly() {
    const plugins = fakeProvider('plugin', [
      plugin('review@official', 'official', { icon: '/media/review.svg', category: 'development' }),
      plugin('pg@official', 'official', { category: 'database' }),
      plugin('risky@community', 'community', { icon: '/media/risky.svg', featured: true }),
    ])
    return storeOf([plugins.provider]).store
  }

  test('Start here falls back to the official listings, never a community one', async () => {
    const answer = await officialOnly().discover(actor, {})
    expect(ids(answer, 'start')?.sort()).toEqual(['pg@official', 'review@official'])
    expect(answer.listings.map((listing) => listing.ref.id)).toContain('review@official')
  })
})
