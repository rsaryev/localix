import { describe, expect, test } from 'bun:test'
import type { SemanticSource, SemanticSourceItem } from '@localixai/mini-app-sdk/backend'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createIndexer } from './indexer'
import { createSemanticStore } from './store'
import { createFakeEngine, FAKE_DIMENSIONS } from './testing/fake-engine'
import { createVectorCache } from './vector-cache'

const item = (key: string, text: string): SemanticSourceItem => ({ key, text, userId: 'u1' })

async function setup(overrides: { failRead?: () => boolean } = {}) {
  const db = createDatabase()
  await migrateToLatest(db)
  const store = createSemanticStore(db)
  const cache = createVectorCache(store, () => FAKE_DIMENSIONS)
  const items = new Map([['a', item('a', 'webhook retry')]])
  const reads: string[][] = []
  const source: SemanticSource = {
    collection: 'notes',
    version: 1,
    scan: async () => ({ items: [...items.values()], next: null }),
    read: async (keys) => {
      reads.push(keys)
      if (overrides.failRead?.()) throw new Error('offline')
      return keys.flatMap((key) => items.get(key) ?? [])
    },
  }
  const timers: number[] = []
  let retry: (() => void) | null = null
  const indexer = createIndexer({
    store,
    cache,
    sources: () => [source],
    setTimer: (fire, ms) => {
      timers.push(ms)
      retry = fire
      return () => {
        retry = null
      }
    },
  })
  return {
    store,
    items,
    reads,
    timers,
    indexer,
    retry: () => retry?.(),
    start: () => indexer.start(createFakeEngine({ calls: [] })),
  }
}

describe('semantic indexer', () => {
  test('runs when there is work and arms no timer once the index is in step', async () => {
    const index = await setup()
    index.start()
    await index.indexer.whenSettled()
    expect(index.indexer.progress().phase).toBe('idle')
    expect(index.timers).toEqual([])

    // A queued change is indexed because it was kicked, not because a timer came round.
    index.items.set('b', item('b', 'font choice'))
    await index.store.enqueue('notes', ['b'])
    index.indexer.kick()
    await index.indexer.whenSettled()
    expect(index.reads).toEqual([['b']])
    expect(await index.store.outboxSize()).toBe(0)
    expect(index.timers).toEqual([])
    await index.indexer.stop()
  })

  test('a failed pass retries with backoff, and the retry clears once it succeeds', async () => {
    let failing = true
    const index = await setup({ failRead: () => failing })
    index.start()
    await index.indexer.whenSettled()
    await index.store.enqueue('notes', ['a'])
    index.indexer.kick()
    await index.indexer.whenSettled()
    expect(index.indexer.progress().phase).toBe('retrying')
    expect(index.timers).toEqual([5_000])

    failing = false
    index.retry()
    await index.indexer.whenSettled()
    expect(index.indexer.progress().phase).toBe('idle')
    expect(await index.store.outboxSize()).toBe(0)
    expect(index.timers).toEqual([5_000])
    await index.indexer.stop()
  })
})

describe('a reconcile in the background', () => {
  // The Store's collection grows while it is scanned (fetched packages add cards): the status
  // bar read 134% because the total was counted once, at the start.
  async function growing(pace?: () => Promise<void>) {
    const db = createDatabase()
    await migrateToLatest(db)
    const store = createSemanticStore(db)
    const cache = createVectorCache(store, () => FAKE_DIMENSIONS)
    const all = Array.from({ length: 100 }, (_, i) => item(`k${i}`, `card ${i}`))
    let counted = 40
    const source: SemanticSource = {
      collection: 'store',
      version: 1,
      count: async () => counted,
      scan: async (cursor, limit) => {
        counted = all.length
        const from = cursor ? Number(cursor) : 0
        const items = all.slice(from, from + limit)
        return { items, next: from + limit < all.length ? String(from + limit) : null }
      },
      read: async () => [],
    }
    const seen: Array<{ scanned: number | null; total: number | null }> = []
    const indexer = createIndexer({
      store,
      cache,
      sources: () => [source],
      onProgress: () => {
        const [c] = indexer.progress().collections
        if (c?.reconciling) seen.push({ scanned: c.scanned, total: c.total })
      },
      ...(pace ? { pace } : {}),
    })
    indexer.start(createFakeEngine({ calls: [] }))
    await indexer.whenSettled()
    await indexer.stop()
    return seen
  }

  test('progress never passes its total when the collection grows during the scan', async () => {
    const seen = await growing()
    expect(seen.filter((p) => (p.scanned ?? 0) > (p.total ?? Infinity))).toEqual([])
    expect(seen.at(-1)).toEqual({ scanned: 100, total: 100 })
  })

  test('it yields to the rest of the app between pages, at a pace it is given', async () => {
    let yields = 0
    await growing(async () => {
      yields++
    })
    expect(yields).toBe(1)
  })
})
