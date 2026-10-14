import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db'
import type { SecretsStore } from './store-contracts'
import { metadataFor, toMeta } from './store-internals'

export function createSecretsQueries(
  db: Kysely<AppDatabase>,
): Pick<SecretsStore, 'list' | 'listVersions' | 'listAudit'> {
  return {
    async list(userId) {
      const rows = await db
        .selectFrom('vault_items as item')
        .leftJoin('vault_aliases as alias', (join) =>
          join.onRef('alias.item_id', '=', 'item.id').on('alias.user_id', '=', userId),
        )
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
        ])
        .where('item.user_id', '=', userId)
        .where('item.deleted_at', 'is', null)
        .orderBy('item.updated_at', 'desc')
        .execute()
      return rows.map(toMeta)
    },

    async listVersions(userId, key) {
      const item = await metadataFor(db, userId, key)
      if (!item) return []
      const rows = await db
        .selectFrom('vault_item_versions')
        .select(['version', 'reason', 'created_at', 'redacted_at'])
        .where('item_id', '=', item.id)
        .orderBy('version', 'desc')
        .execute()
      return rows.map((row) => ({
        version: row.version,
        reason: row.reason,
        createdAt: Date.parse(row.created_at),
        redactedAt: row.redacted_at ? Date.parse(row.redacted_at) : undefined,
      }))
    },

    async listAudit(userId, limit = 100) {
      const rows = await db
        .selectFrom('vault_audit as audit')
        .leftJoin('vault_items as item', 'item.id', 'audit.item_id')
        .leftJoin('vault_aliases as alias', (join) =>
          join.onRef('alias.item_id', '=', 'audit.item_id').on('alias.user_id', '=', userId),
        )
        .select([
          'audit.id',
          'audit.item_id',
          'audit.actor_type',
          'audit.actor_id',
          'audit.consumer_type',
          'audit.consumer_id',
          'audit.operation',
          'audit.result',
          'audit.created_at',
          'item.name',
          'alias.alias',
        ])
        .where('audit.user_id', '=', userId)
        .orderBy('audit.id', 'desc')
        .limit(Math.max(1, Math.min(limit, 200)))
        .execute()
      return rows.map((row) => ({
        id: row.id,
        itemId: row.item_id,
        key: row.alias,
        label: row.name,
        actorType: row.actor_type,
        actorId: row.actor_id,
        consumerType: row.consumer_type || undefined,
        consumerId: row.consumer_id || undefined,
        operation: row.operation,
        result: row.result,
        createdAt: Date.parse(row.created_at),
      }))
    },
  }
}
