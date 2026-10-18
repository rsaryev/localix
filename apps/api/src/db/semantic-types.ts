import type { Generated } from 'kysely'

/** The single machine-wide switch and model choice (`id` is always 1). */
export interface SemanticSettingsTable {
  id: number
  enabled: number
  model_id: string | null
  /** Who chose a provider model: the indexer embeds with their connection. */
  owner_user_id: string | null
  updated_at: string
}

/** One registered collection's vector space and backfill progress. */
export interface SemanticCollectionsTable {
  name: string
  fingerprint: string
  source_version: number
  backfill_cursor: string | null
  backfill_done: number
  updated_at: string
}

/** One embedded chunk of one source item. */
export interface SemanticItemsTable {
  id: Generated<number>
  collection: string
  item_key: string
  chunk: number
  user_id: string
  scope: string | null
  /** The item whose deletion removes this one (a message's chat), when it has one. */
  parent: string | null
  content_hash: string
  excerpt: string
  vector: Uint8Array
  created_at: string
}

/** Keys whose source rows changed since they were embedded. */
export interface SemanticOutboxTable {
  seq: Generated<number>
  collection: string
  item_key: string
}
