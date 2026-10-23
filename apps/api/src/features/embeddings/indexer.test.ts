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
