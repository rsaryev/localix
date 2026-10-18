/**
 * Source items → stored vectors. The write half of the semantic index.
 *
 * Every item is hashed (task, title, text) before anything is embedded, and an item whose hash
 * matches what is stored is skipped — which is what makes a reconcile scan after a restart, or
 * re-enabling the feature, cost a read instead of a re-embed. Items with no embeddable text
 * are removed. Embedding goes in small batches (`BATCH_INPUTS` chunks) so a person's query
 * never waits behind a long one.
 */
import type { SemanticSourceItem } from '@localixai/plugin-sdk/backend'
import { chunkText } from './chunking'
import type { EmbeddingEngine } from './engine'
import type { SemanticStore } from './store'
import type { VectorCache } from './vector-cache'
import { encodeVector } from './vectors'

/** Chunks per embedding request. ~150 ms on Apple silicon, a few seconds on a slow CPU. */
export const BATCH_INPUTS = 8

export interface IngestStats {
  embedded: number
  chunks: number
  skipped: number
  removed: number
}

export function contentHash(item: Pick<SemanticSourceItem, 'text' | 'title' | 'task'>): string {
  return Bun.hash(`${item.task ?? 'search'}\u0000${item.title ?? ''}\u0000${item.text}`).toString(
    36,
  )
}

interface Prepared {
  item: SemanticSourceItem
  hash: string
  chunks: string[]
}

export async function ingestItems(
  deps: { store: SemanticStore; cache: VectorCache; engine: EmbeddingEngine },
  collection: string,
  items: readonly SemanticSourceItem[],
  options: { yieldEvery?: () => Promise<void> } = {},
): Promise<IngestStats> {
  const { store, cache, engine } = deps
  const stats: IngestStats = { embedded: 0, chunks: 0, skipped: 0, removed: 0 }
  if (items.length === 0) return stats

  const stored = await store.hashesOf(
    collection,
    items.map((i) => i.key),
  )
  const empty: string[] = []
  const work: Prepared[] = []
  for (const item of items) {
    const chunks = chunkText(item.text, engine.model.maxChunkChars)
    if (chunks.length === 0) {
      if (stored.has(item.key)) empty.push(item.key)
      else stats.skipped += 1
      continue
    }
    const hash = contentHash(item)
    if (stored.get(item.key) === hash) {
      stats.skipped += 1
      continue
    }
    work.push({ item, hash, chunks })
  }
  if (empty.length) {
    await store.removeItems(collection, empty)
    cache.removed(collection, empty)
    stats.removed += empty.length
  }

  // Fill batches across item boundaries; an item is written once all its chunks are embedded.
  let pending: Array<{ prepared: Prepared; index: number }> = []
  const vectors = new Map<Prepared, Float32Array[]>()
  const flush = async () => {
    if (pending.length === 0) return
    const batch = pending
    pending = []
    const out = await engine.embedDocuments(
      batch.map(({ prepared, index }) => ({
        text: prepared.chunks[index]!,
        title: prepared.item.title,
        task: prepared.item.task,
      })),
    )
    batch.forEach(({ prepared, index }, i) => {
      const list = vectors.get(prepared) ?? []
      list[index] = out[i]!
      vectors.set(prepared, list)
    })
    for (const prepared of new Set(batch.map((b) => b.prepared))) {
      const list = vectors.get(prepared)!
      if (list.filter(Boolean).length < prepared.chunks.length) continue
      vectors.delete(prepared)
      await write(prepared, list)
    }
    await options.yieldEvery?.()
  }

  const write = async (prepared: Prepared, list: Float32Array[]) => {
    const { item } = prepared
    const ids = await store.replaceItem(collection, {
      key: item.key,
      userId: item.userId,
      scope: item.scope ?? null,
      hash: prepared.hash,
      chunks: prepared.chunks.map((excerpt, i) => ({ excerpt, vector: encodeVector(list[i]!) })),
    })
    cache.written(
      collection,
      item.userId,
      item.key,
      ids.map((id, chunk) => ({ id, chunk, scope: item.scope ?? null, vector: list[chunk]! })),
    )
    stats.embedded += 1
    stats.chunks += prepared.chunks.length
  }

  for (const prepared of work) {
    for (let index = 0; index < prepared.chunks.length; index++) {
      pending.push({ prepared, index })
      if (pending.length >= BATCH_INPUTS) await flush()
    }
  }
  await flush()
  return stats
}

/** Delete items whose source rows are gone. */
export async function removeKeys(
  deps: { store: SemanticStore; cache: VectorCache },
  collection: string,
  keys: readonly string[],
): Promise<number> {
  if (keys.length === 0) return 0
  await deps.store.removeItems(collection, keys)
  deps.cache.removed(collection, keys)
  return keys.length
}
