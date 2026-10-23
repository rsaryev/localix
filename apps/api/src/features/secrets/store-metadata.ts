import type { Kysely, Transaction } from 'kysely'
import type { AppDatabase } from '../../db'
import { recordCoreChanges } from '../changes/core-entities'
import {
  secretKeySchema,
  toSecretHandle,
  type SecretMeta,
  type VaultItemSource,
  type VaultItemType,
} from './contracts'

const safeTags = (raw: string): string[] => {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((tag): tag is string => typeof tag === 'string')
      : []
  } catch {
    return []
  }
}

type VaultDb = Kysely<AppDatabase> | Transaction<AppDatabase>

export interface VaultItemRow {
  id: string
  kind: string
  name: string
  description: string
  source: string
  backend: string
  current_version: number
  tags_json: string
  created_at: string
  updated_at: string
  alias: string | null
  field: string
}

export const metadataFor = (
  database: VaultDb,
  userId: string,
  key: string,
): Promise<VaultItemRow | undefined> =>
  database
    .selectFrom('vault_aliases as alias')
    .innerJoin('vault_items as item', 'item.id', 'alias.item_id')
    .select([
      'item.id',
      'item.kind',
      'item.name',
      'item.description',
      'item.source',
      'item.backend',
      'item.current_version',
      'item.tags_json',
      'item.created_at',
      'item.updated_at',
      'alias.alias',
      'alias.field',
    ])
    .where('alias.user_id', '=', userId)
    .where('alias.alias', '=', key)
    .where('item.deleted_at', 'is', null)
    .executeTakeFirst()

export const toMeta = (row: Omit<VaultItemRow, 'field'>): SecretMeta => {
  const source = row.source as VaultItemSource
  const key = row.alias ?? row.id
  return {
    id: row.id,
    key,
    label: row.name,
    description: row.description || undefined,
    type: row.kind as VaultItemType,
    source,
    backend: row.backend,
    version: row.current_version,
    tags: safeTags(row.tags_json),
    reference:
      row.alias &&
      (source === 'user' || source === 'plugin') &&
      secretKeySchema.safeParse(key).success
        ? toSecretHandle(key)
        : null,
    createdAt: Date.parse(row.created_at),
    updatedAt: Date.parse(row.updated_at),
  }
}

export const insertAudit = (
  database: VaultDb,
  input: {
    userId: string
    itemId?: string | null
    operation: string
    result: string
    actorType?: string
    actorId?: string
    consumerType?: string
    consumerId?: string
    context?: Record<string, unknown>
    at: string
  },
) =>
  database
    .insertInto('vault_audit')
    .values({
      user_id: input.userId,
      item_id: input.itemId ?? null,
      actor_type: input.actorType ?? 'user',
      actor_id: input.actorId ?? input.userId,
      consumer_type: input.consumerType ?? '',
      consumer_id: input.consumerId ?? '',
      operation: input.operation,
      result: input.result,
      context_json: JSON.stringify(input.context ?? {}),
      created_at: input.at,
    })
    .execute()

/** One immutable version of an item's encrypted fields. */
export const insertItemVersion = (
  database: VaultDb,
  input: {
    id: string
    itemId: string
    version: number
    encrypted: string
    reason: string
    at: string
  },
) =>
  database
    .insertInto('vault_item_versions')
    .values({
      id: input.id,
      item_id: input.itemId,
      version: input.version,
      encrypted_payload: input.encrypted,
      payload_ref: null,
      payload_schema: 'localix.fields.v1',
      reason: input.reason,
      created_at: input.at,
      redacted_at: null,
    })
    .execute()

/** A vault item changed or went away: announced in the write's transaction, by its key. */
export const announceVaultItem = (
  tx: Transaction<AppDatabase>,
  userId: string,
  key: string,
  op: 'upserted' | 'deleted',
) => recordCoreChanges(tx, { entity: 'secret', op, ref: { userId, key } })
