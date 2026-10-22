import type { Generated } from 'kysely'

/**
 * Row types of the Localix Vault's tables, in their own module for size. They belong to the
 * `AppDatabase` registry in `types.ts`, which re-exports them.
 */

/** Non-secret catalog row for one item in the unified Localix Vault. */
export interface VaultItemsTable {
  id: string
  user_id: string
  kind: string
  name: string
  description: string
  folder_id: string | null
  backend: string
  external_ref: string | null
  source: string
  schema_version: number
  current_version: number
  favorite: number
  tags_json: string
  created_at: string
  updated_at: string
  deleted_at: string | null
}

/** Immutable encrypted snapshots. Restore always appends another version. */
export interface VaultItemVersionsTable {
  id: string
  item_id: string
  version: number
  encrypted_payload: string | null
  payload_ref: string | null
  payload_schema: string
  reason: string
  created_at: string
  redacted_at: string | null
}

/** Stable config-facing aliases such as `OPENAI_API_KEY` → item id + field. */
export interface VaultAliasesTable {
  user_id: string
  alias: string
  item_id: string
  field: string
  created_at: string
}

export interface VaultFoldersTable {
  id: string
  user_id: string
  parent_id: string | null
  name: string
  description: string
  created_at: string
  updated_at: string
}

/** Value-free reverse references used for usage UI and guarded deletion. */
export interface VaultItemBindingsTable {
  user_id: string
  item_id: string
  consumer_type: string
  consumer_id: string
  field: string
  label: string
  created_at: string
  updated_at: string
}

/** Metadata-only audit; secret material and request bodies never enter this table. */
export interface VaultAuditTable {
  id: Generated<number>
  user_id: string
  item_id: string | null
  actor_type: string
  actor_id: string
  consumer_type: string
  consumer_id: string
  operation: string
  result: string
  context_json: string
  created_at: string
}
