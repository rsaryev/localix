import { describe, expect, test } from 'bun:test'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { ingestItems } from './ingest'
import { createSemanticReader } from './semantic-index'
import { createSemanticStore } from './store'
import { createSemanticVectors } from './semantic-vectors'
import { createFakeEngine, FAKE_DIMENSIONS } from './testing/fake-engine'
import { createVectorCache } from './vector-cache'

/** The vectors port over one engine, as the semantic service builds it. */
const vectorsOf = (engine: ReturnType<typeof createFakeEngine>) =>
  createSemanticVectors({ strategy: () => ({ mode: 'hybrid' }), engine: () => engine })

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const store = createSemanticStore(db)
  const cache = createVectorCache(store, () => FAKE_DIMENSIONS)
  const calls: string[][] = []
  const engine = createFakeEngine({ calls })
  const reader = createSemanticReader({ store, cache, vectors: vectorsOf(engine) })
  return { db, store, cache, engine, reader, calls }
}

const item = (key: string, text: string, extra: { userId?: string; scope?: string } = {}) => ({
  key,
  text,
  userId: extra.userId ?? 'u1',
  scope: extra.scope ?? 'p1',
})

// Enough unrelated items that the collection defines its own z-scale.
const filler = Array.from({ length: 30 }, (_, i) =>
  item(`f${i}`, `note ${i} about lunch plans and weather ${i}`),
)

describe('semantic index', () => {
  test('ingest embeds new items, skips unchanged ones, and re-embeds an edit', async () => {
    const { store, cache, engine, calls } = await setup()
    const first = await ingestItems({ store, cache, engine }, 'c', [
      item('a', 'webhook retry backoff'),
      item('b', 'font choice'),
    ])
    expect(first).toMatchObject({ embedded: 2, chunks: 2, skipped: 0 })
    calls.length = 0
    const again = await ingestItems({ store, cache, engine }, 'c', [
      item('a', 'webhook retry backoff'),
      item('b', 'typography choice'),
    ])
    expect(again).toMatchObject({ embedded: 1, skipped: 1 })
    expect(calls.flat()).toEqual(['D::typography choice'])
  })

  test('an item whose text became empty is removed', async () => {
    const { store, cache, engine } = await setup()
    await ingestItems({ store, cache, engine }, 'c', [item('a', 'webhook retry')])
    const stats = await ingestItems({ store, cache, engine }, 'c', [item('a', '   ')])
    expect(stats.removed).toBe(1)
    expect((await store.counts()).get('c')).toBeUndefined()
  })

  test('similar finds the item by meaning, across languages, with its excerpt', async () => {
    const { store, cache, engine, reader } = await setup()
    await ingestItems({ store, cache, engine }, 'c', [
      ...filler,
      item('hit', 'Configured webhook redelivery with exponential backoff'),
    ])
    const query = reader.queryFor('u1', 'reintento callback')!
    const [best] = await query.similar('c', { limit: 3 })
    expect(best).toMatchObject({
      key: 'hit',
      excerpt: 'Configured webhook redelivery with exponential backoff',
    })
    expect(best!.z).toBeGreaterThan(query.zGate)
  })

  test('items like these items are found by their stored vectors, weighted, nothing embedded', async () => {
    const { store, cache, engine, reader, calls } = await setup()
    await ingestItems({ store, cache, engine }, 'c', [
      ...filler,
      item('retry', 'webhook retry backoff'),
      item('redeliver', 'webhook redelivery with exponential backoff'),
      item('font', 'font choice and typography'),
      item('serif', 'serif typeface pairing for typography'),
    ])
    calls.length = 0

    const near = await reader.similarToItems('u1', 'c', [
      { key: 'retry', weight: 1 },
      { key: 'font', weight: 0.1 },
    ])
    const nearest = near!.find((match) => match.key !== 'retry' && match.key !== 'font')

    expect(nearest?.key).toBe('redeliver')
    expect(calls).toEqual([])
    expect(await reader.similarToItems('u1', 'c', [{ key: 'gone', weight: 1 }])).toBeNull()
  })

  test("a query never sees another user's items, and scope filters", async () => {
    const { store, cache, engine, reader } = await setup()
    await ingestItems({ store, cache, engine }, 'c', [
      item('mine', 'payment declined', { scope: 'p1' }),
      item('other-project', 'payment declined', { scope: 'p2' }),
      item('theirs', 'payment declined', { userId: 'u2' }),
    ])
    const keys = async (scope?: string) =>
      (await reader.query('u1', 'c', 'card payment', scope ? { scope } : {}))
        .map((m) => m.key)
        .sort()
    expect(await keys()).toEqual(['mine', 'other-project'])
    expect(await keys('p2')).toEqual(['other-project'])
  })

  test('a loaded matrix picks up new items in place and reloads after an edit', async () => {
    const { store, cache, engine, reader } = await setup()
    // What stands out for the collection's own gate — the threshold search uses.
    const standouts = async () =>
      (await reader.query('u1', 'c', 'docker compose'))
        .filter((m) => m.z >= m.gate)
        .map((m) => m.key)
    await ingestItems({ store, cache, engine }, 'c', filler)
    expect(await standouts()).toEqual([])
    await ingestItems({ store, cache, engine }, 'c', [item('new', 'docker compose up fails')])
    expect(await standouts()).toEqual(['new'])
    await ingestItems({ store, cache, engine }, 'c', [item('new', 'lunch plans')])
    expect(await standouts()).toEqual([])
  })

  test('long text is several chunks and the best chunk represents the item', async () => {
    const { store, cache, engine, reader } = await setup()
    const long = `${'Weather and lunch notes. '.repeat(30)}Then we fixed the postgres port conflict.`
    await ingestItems({ store, cache, engine }, 'c', [...filler, item('long', long)])
    expect((await store.counts()).get('c')!.chunks).toBeGreaterThan(31)
    const [best] = await reader.query('u1', 'c', 'database port', { limit: 1 })
    expect(best!.key).toBe('long')
    expect(best!.excerpt).toContain('postgres port conflict')
  })

  test('a query vector that is not ready in time answers empty and says it missed', async () => {
    const { store, cache, engine } = await setup()
    await ingestItems({ store, cache, engine }, 'c', [item('a', 'webhook retry')])
    const slow = { ...engine, embedQuery: () => new Promise<Float32Array>(() => {}) }
    const reader = createSemanticReader({
      store,
      cache,
      vectors: vectorsOf(slow),
      queryBudgetMs: 20,
    })
    const query = reader.queryFor('u1', 'retry')!
    expect(await query.similar('c')).toEqual([])
    expect(query.missed).toBe(true)
  })
})
