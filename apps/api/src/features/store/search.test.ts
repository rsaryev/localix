import { afterEach, describe, expect, test } from 'bun:test'
import type { Listing, StoreProvider } from '@localixai/store'

import { fakeProvider, makeListing } from './testing/fake-provider'
import { makeStore } from './testing/store'
import { refOfStoreHit } from './search-provider'

const actor = { userId: 'u1' }
let opened: ReturnType<typeof makeStore> | null = null
afterEach(async () => {
  await opened?.close()
  opened = null
})
const storeOf = (providers: StoreProvider[], opts?: Parameters<typeof makeStore>[1]) =>
  (opened = makeStore(providers, opts))
const ids = (listings: readonly Listing[]) => listings.map((listing) => listing.ref.id)

const from = (
  trust: 'localix' | 'official' | 'community',
  id: string,
  over: Partial<Listing> = {},
) =>
  makeListing({
    id,
    kind: 'plugin',
    displayName: 'Postgres tools',
    summary: 'Query and migrate a Postgres database',
    tags: ['database'],
    source: { id: trust, label: trust, trust },
    ...over,
  })

describe('searching the Store', () => {
  test('goes through global search: by words, Localix above official above community on a tie', async () => {
    const plugins = fakeProvider('plugin', [
      from('community', 'pg@community'),
      from('official', 'pg@official'),
      from('localix', 'pg@localix'),
      makeListing({ id: 'chess', kind: 'plugin', summary: 'Play chess' }),
    ])
    const { store } = storeOf([plugins.provider])
    const page = await store.listings(actor, { q: 'postgres' })
    expect(ids(page.listings)).toEqual(['pg@localix', 'pg@official', 'pg@community'])
    expect(page.strategy).toEqual({ mode: 'lexical' })
  })

  test('relevance comes before trust: every word beats some of them', async () => {
    const plugins = fakeProvider('plugin', [
      from('localix', 'pg-only', { displayName: 'Postgres', summary: 'A database', tags: [] }),
      from('community', 'pg-review', {
        displayName: 'Postgres review',
        summary: 'Review Postgres migrations',
        tags: [],
      }),
    ])
    const { store } = storeOf([plugins.provider])
    expect(ids((await store.listings(actor, { q: 'postgres review' })).listings)).toEqual([
      'pg-review',
      'pg-only',
    ])
  })

  test('finds by meaning what no word of the query names, when the model answers', async () => {
    const k8s = makeListing({
      id: 'helm',
      kind: 'plugin',
      displayName: 'Helm charts',
      summary: 'Ship releases to clusters',
    })
    const plugins = fakeProvider('plugin', [k8s, makeListing({ id: 'chess', kind: 'plugin' })])
    const { store } = storeOf([plugins.provider], {
      meaning: () => [
        { key: 'plugin:helm', z: 4 },
        { key: 'plugin:chess', z: 0.1 },
      ],
    })
    const page = await store.listings(actor, { q: 'kubernetes' })
    expect(ids(page.listings)).toEqual(['helm'])
    expect(page.strategy).toEqual({ mode: 'hybrid' })
  })

  test('keeps to the shelf and filters the Store shows', async () => {
    const plugins = fakeProvider('plugin', [
      from('official', 'pg@official', { category: 'database' }),
      from('community', 'pg@community', { category: 'development' }),
    ])
    const { store } = storeOf([plugins.provider])
    const page = await store.listings(actor, { q: 'postgres', category: 'Data' })
    expect(ids(page.listings)).toEqual(['pg@official'])
    expect(
      ids((await store.listings(actor, { q: 'postgres', source: 'community' })).listings),
    ).toEqual(['pg@community'])
  })

  test('in the palette: five packages at most, none installed, each opening its Store page', async () => {
    const many = Array.from({ length: 8 }, (_, n) => from('official', `pg-${n}`))
    const installed = from('localix', 'pg-mine', {
      installs: [{ scope: 'user', enabled: true }],
    })
    const { store, search } = storeOf([fakeProvider('plugin', [...many, installed]).provider])
    await store.listings(actor, {})
    const answer = await search.search('u1', { text: 'postgres' })
    const group = answer.groups.find((found) => found.domain === 'store')!
    expect(group.title).toBe('Store')
    expect(group.total).toBe(5)
    expect(group.hits.map((hit) => refOfStoreHit(hit)?.id)).not.toContain('pg-mine')
    expect(group.hits[0]!.uri).toMatch(/^localix:\/\/ui\/work-item\/store\?kind=plugin&id=pg-/)
  })

  test('a long result list comes a page at a time', async () => {
    const many = Array.from({ length: 45 }, (_, n) => from('official', `pg-${n}`))
    const { store } = storeOf([fakeProvider('plugin', many).provider])
    const first = await store.listings(actor, { q: 'postgres' })
    expect(first.listings).toHaveLength(40)
    const second = await store.listings(actor, { q: 'postgres', cursor: first.nextCursor! })
    expect(second.listings).toHaveLength(5)
    expect(new Set([...ids(first.listings), ...ids(second.listings)]).size).toBe(45)
  })

  test('the open project lifts what suits it, on a shelf and in a search', async () => {
    const plugins = fakeProvider('plugin', [
      from('official', 'pyright', { tags: ['python', 'lsp'], displayName: 'Pyright LSP' }),
      from('official', 'vtsls', { tags: ['typescript', 'lsp'], displayName: 'TypeScript LSP' }),
    ])
    const { store } = storeOf([plugins.provider], { projectWords: ['typescript'] })
    expect(ids((await store.listings(actor, { projectId: 'p1' })).listings)).toEqual([
      'vtsls',
      'pyright',
    ])
    expect(ids((await store.listings(actor, { q: 'lsp', projectId: 'p1' })).listings)).toEqual([
      'vtsls',
      'pyright',
    ])
  })
})
