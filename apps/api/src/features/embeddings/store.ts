/**
 * Persistence for the semantic index: settings, per-collection state, embedded chunks and the
 * change outbox. Rows only — vectors arrive here already encoded, and nothing in this file
 * knows what a model or a search is.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'

export interface StoredChunk {
  excerpt: string
  vector: Uint8Array
}

export interface StoredItem {
  key: string
  userId: string
  scope: string | null
  parent: string | null
  hash: string
  chunks: StoredChunk[]
}

export interface VectorRow {
  id: number
  item_key: string
  chunk: number
  scope: string | null
  vector: Uint8Array
}

export interface CollectionState {
  name: string
  fingerprint: string
  sourceVersion: number
  backfillCursor: string | null
  backfillDone: boolean
}

const now = () => new Date().toISOString()
/** SQLite's default bound-parameter ceiling is 32766; stay far below it. */
const KEY_BATCH = 500

function batches<T>(values: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += KEY_BATCH) out.push(values.slice(i, i + KEY_BATCH))
  return out
}

export interface SemanticSettings {
  enabled: boolean
  modelId: string | null
  ownerUserId: string | null
}

export function createSemanticStore(db: Kysely<AppDatabase>) {
  return {
    async readSettings(): Promise<SemanticSettings> {
      const row = await db
        .selectFrom('semantic_settings')
        .select(['enabled', 'model_id', 'owner_user_id'])
        .where('id', '=', 1)
        .executeTakeFirst()
      return {
        // On until a person turns it off: a new computer has it from the first start.
        enabled: row ? row.enabled === 1 : true,
        modelId: row?.model_id ?? null,
        ownerUserId: row?.owner_user_id ?? null,
      }
    },

    async writeSettings(settings: SemanticSettings) {
      const values = {
        enabled: settings.enabled ? 1 : 0,
        model_id: settings.modelId,
        owner_user_id: settings.ownerUserId,
        updated_at: now(),
      }
      await db
        .insertInto('semantic_settings')
        .values({ id: 1, ...values })
        .onConflict((oc) => oc.column('id').doUpdateSet(values))
        .execute()
    },

    async readCollection(name: string): Promise<CollectionState | null> {
      const row = await db
        .selectFrom('semantic_collections')
        .selectAll()
        .where('name', '=', name)
        .executeTakeFirst()
      if (!row) return null
      return {
        name: row.name,
        fingerprint: row.fingerprint,
        sourceVersion: row.source_version,
        backfillCursor: row.backfill_cursor,
        backfillDone: row.backfill_done === 1,
      }
    },

    async writeCollection(state: CollectionState) {
      const values = {
        fingerprint: state.fingerprint,
        source_version: state.sourceVersion,
        backfill_cursor: state.backfillCursor,
        backfill_done: state.backfillDone ? 1 : 0,
        updated_at: now(),
      }
      await db
        .insertInto('semantic_collections')
        .values({ name: state.name, ...values })
        .onConflict((oc) => oc.column('name').doUpdateSet(values))
        .execute()
    },

    /** Drop every vector of a collection (a new model or source version starts it over). */
    async clearCollection(name: string) {
      await db.deleteFrom('semantic_items').where('collection', '=', name).execute()
    },

    /** Every collection's state, or only `only`'s. */
    async listCollections(only?: string): Promise<CollectionState[]> {
      const names = await db
        .selectFrom('semantic_collections')
        .select('name')
        .$if(only !== undefined, (q) => q.where('name', '=', only!))
        .execute()
      const out: CollectionState[] = []
      for (const { name } of names) {
        const state = await this.readCollection(name)
        if (state) out.push(state)
      }
      return out
    },

    /** Stored content hash per key, for skipping items whose text did not change. */
    async hashesOf(collection: string, keys: readonly string[]): Promise<Map<string, string>> {
      const out = new Map<string, string>()
      for (const batch of batches(keys)) {
        const rows = await db
          .selectFrom('semantic_items')
          .select(['item_key', 'content_hash'])
          .where('collection', '=', collection)
          .where('chunk', '=', 0)
          .where('item_key', 'in', batch)
          .execute()
        for (const row of rows) out.set(row.item_key, row.content_hash)
      }
      return out
    },

    /** Replace an item's chunks in one transaction. Returns the new row ids, chunk order. */
    async replaceItem(collection: string, item: StoredItem): Promise<number[]> {
      return db.transaction().execute(async (trx) => {
        await trx
          .deleteFrom('semantic_items')
          .where('collection', '=', collection)
          .where('item_key', '=', item.key)
          .execute()
        const ids: number[] = []
        const createdAt = now()
        for (const [chunk, stored] of item.chunks.entries()) {
          const row = await trx
            .insertInto('semantic_items')
            .values({
              collection,
              item_key: item.key,
              chunk,
              user_id: item.userId,
              scope: item.scope,
              parent: item.parent,
              content_hash: item.hash,
              excerpt: stored.excerpt,
              vector: stored.vector,
              created_at: createdAt,
            })
            .returning('id')
            .executeTakeFirstOrThrow()
          ids.push(row.id)
        }
        return ids
      })
    },

    async removeItems(collection: string, keys: readonly string[]) {
      for (const batch of batches(keys)) {
        await db
          .deleteFrom('semantic_items')
          .where('collection', '=', collection)
          .where('item_key', 'in', batch)
          .execute()
      }
    },

    /** The keys stored under `parent` (its deletion removes them). */
    async keysUnder(collection: string, parent: string): Promise<string[]> {
      const rows = await db
        .selectFrom('semantic_items')
        .select('item_key')
        .distinct()
        .where('collection', '=', collection)
        .where('parent', '=', parent)
        .execute()
      return rows.map((r) => r.item_key)
    },

    /** Every stored key of a collection (reconcile: what a full scan did not see is gone). */
    async keysOf(collection: string): Promise<string[]> {
      const rows = await db
        .selectFrom('semantic_items')
        .select('item_key')
        .distinct()
        .where('collection', '=', collection)
        .execute()
      return rows.map((r) => r.item_key)
    },

    /** Every vector of one user's collection, for the in-memory matrix. */
    async loadVectors(collection: string, userId: string): Promise<VectorRow[]> {
      return db
        .selectFrom('semantic_items')
        .select(['id', 'item_key', 'chunk', 'scope', 'vector'])
        .where('collection', '=', collection)
        .where('user_id', '=', userId)
        .orderBy('id')
        .execute()
    },

    async excerpts(ids: readonly number[]): Promise<Map<number, string>> {
      const out = new Map<number, string>()
      for (const batch of batches(ids)) {
        const rows = await db
          .selectFrom('semantic_items')
          .select(['id', 'excerpt'])
          .where('id', 'in', batch)
          .execute()
        for (const row of rows) out.set(row.id, row.excerpt)
      }
      return out
    },

    /** Items (distinct keys) and chunks per collection. */
    async counts(): Promise<Map<string, { items: number; chunks: number }>> {
      const rows = await db
        .selectFrom('semantic_items')
        .select((eb) => [
          'collection',
          eb.fn.countAll<number>().as('chunks'),
          eb.fn.count<number>('item_key').distinct().as('items'),
        ])
        .groupBy('collection')
        .execute()
      return new Map(
        rows.map((r) => [r.collection, { items: Number(r.items), chunks: Number(r.chunks) }]),
      )
    },

    async enqueue(collection: string, keys: readonly string[]) {
      for (const batch of batches(keys)) {
        await db
          .insertInto('semantic_outbox')
          .values(batch.map((item_key) => ({ collection, item_key })))
          .onConflict((oc) => oc.columns(['collection', 'item_key']).doNothing())
          .execute()
      }
    },

    async takeOutbox(limit: number) {
      return db
        .selectFrom('semantic_outbox')
        .select(['seq', 'collection', 'item_key'])
        .orderBy('seq')
        .limit(limit)
        .execute()
    },

    async ackOutbox(seqs: readonly number[]) {
      for (const batch of batches(seqs)) {
        await db.deleteFrom('semantic_outbox').where('seq', 'in', batch).execute()
      }
    },

    async outboxSize(): Promise<number> {
      const row = await db
        .selectFrom('semantic_outbox')
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirst()
      return Number(row?.n ?? 0)
    },

    /** Forget queued changes, e.g. for a collection that is being rebuilt from a full scan. */
    async clearOutbox(collection?: string) {
      let q = db.deleteFrom('semantic_outbox')
      if (collection) q = q.where('collection', '=', collection)
      await q.execute()
    },
  }
}

export type SemanticStore = ReturnType<typeof createSemanticStore>
