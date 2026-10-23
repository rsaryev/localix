import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { localixHome } from '../../lib/env'
import type { SecretsStore } from './store-contracts'
import { createSecretsQueries } from './store-queries'
import { createAesCipher, type SecretCipher } from './cipher'
import { loadOrCreateMasterKey } from './master-key'
import {
  createItem,
  decryptItemValue,
  announceVaultItem,
  insertAudit,
  metadataFor,
  rotateItem,
  updateItemMetadata,
  VaultPayloadError,
} from './store-internals'

export { defaultLegacySecretsDir, migrateLegacySecrets } from './legacy-migration'

export type { VaultMutationResult, VaultDeleteResult, SecretsStore } from './store-contracts'

/** Key material remains outside the application database for backend portability. */
export function defaultSecretsDir(): string {
  return path.join(localixHome(), 'vault')
}

export function createSecretsStore(options: {
  db: Kysely<AppDatabase>
  keyDir?: string
  cipher?: SecretCipher
  now?: () => Date
  id?: () => string
}): SecretsStore {
  const db = options.db
  const now = options.now ?? (() => new Date())
  const id = options.id ?? randomUUID
  const keyDir = options.keyDir ?? defaultSecretsDir()

  let cipherPromise: Promise<SecretCipher> | null = null
  const getCipher = (): Promise<SecretCipher> => {
    if (options.cipher) return Promise.resolve(options.cipher)
    cipherPromise ??= loadOrCreateMasterKey(keyDir).then(createAesCipher)
    return cipherPromise
  }

  return {
    ...createSecretsQueries(db),

    create(userId, request) {
      return createItem(db, getCipher, now, id, userId, request.key, request.value, {
        label: request.label,
        description: request.description,
        type: request.type,
        tags: request.tags,
        source: 'user',
      })
    },

    rotate(userId, key, value, expectedVersion, audit) {
      return rotateItem(db, getCipher, now, id, userId, key, value, expectedVersion, audit)
    },

    updateMetadata(userId, key, request, audit) {
      return updateItemMetadata(db, getCipher, now, id, userId, key, request, audit)
    },

    async set(userId, key, value, metadata = {}) {
      const current = await metadataFor(db, userId, key)
      if (!current) {
        const created = await createItem(db, getCipher, now, id, userId, key, value, metadata)
        if (created) return created
        return this.set(userId, key, value, metadata)
      }
      const result = await rotateItem(
        db,
        getCipher,
        now,
        id,
        userId,
        key,
        value,
        current.current_version,
        metadata.audit,
      )
      if (result.status === 'updated') return result.item
      if (result.status === 'conflict') return this.set(userId, key, value, metadata)
      throw new Error('Vault item disappeared during managed update')
    },

    async setIfAbsent(userId, key, value, metadata = {}) {
      return (await createItem(db, getCipher, now, id, userId, key, value, metadata)) !== null
    },

    async listBindings(userId, key) {
      const item = await metadataFor(db, userId, key)
      if (!item) return []
      const rows = await db
        .selectFrom('vault_item_bindings')
        .select(['consumer_type', 'consumer_id', 'field', 'label'])
        .where('user_id', '=', userId)
        .where('item_id', '=', item.id)
        .orderBy('consumer_type')
        .orderBy('label')
        .execute()
      return rows.map((row) => ({
        consumerType: row.consumer_type,
        consumerId: row.consumer_id,
        field: row.field,
        label: row.label,
      }))
    },

    async bind(userId, key, binding) {
      const item = await metadataFor(db, userId, key)
      if (!item) return false
      const timestamp = now().toISOString()
      await db
        .insertInto('vault_item_bindings')
        .values({
          user_id: userId,
          item_id: item.id,
          consumer_type: binding.consumerType,
          consumer_id: binding.consumerId,
          field: binding.field,
          label: binding.label,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .onConflict((conflict) =>
          conflict
            .columns(['user_id', 'item_id', 'consumer_type', 'consumer_id', 'field'])
            .doUpdateSet({ label: binding.label, updated_at: timestamp }),
        )
        .execute()
      return true
    },

    async unbindConsumer(userId, consumerType, consumerId) {
      const result = await db
        .deleteFrom('vault_item_bindings')
        .where('user_id', '=', userId)
        .where('consumer_type', '=', consumerType)
        .where('consumer_id', '=', consumerId)
        .executeTakeFirst()
      return Number(result.numDeletedRows)
    },

    async remove(userId, key, options = {}) {
      return db.transaction().execute(async (tx) => {
        const item = await metadataFor(tx, userId, key)
        if (!item) return { status: 'missing' }
        if (
          options.expectedVersion !== undefined &&
          options.expectedVersion !== item.current_version
        ) {
          return { status: 'conflict', currentVersion: item.current_version }
        }
        const bindings = await tx
          .selectFrom('vault_item_bindings')
          .select(['consumer_type', 'consumer_id', 'field', 'label'])
          .where('user_id', '=', userId)
          .where('item_id', '=', item.id)
          .execute()
        if (bindings.length > 0 && !options.force) {
          return {
            status: 'in_use',
            bindings: bindings.map((row) => ({
              consumerType: row.consumer_type,
              consumerId: row.consumer_id,
              field: row.field,
              label: row.label,
            })),
          }
        }
        const timestamp = now().toISOString()
        await insertAudit(tx, {
          userId,
          itemId: item.id,
          operation: 'delete',
          result: 'success',
          actorType: options.audit?.actorType,
          actorId: options.audit?.actorId,
          consumerType: options.audit?.consumerType,
          consumerId: options.audit?.consumerId,
          context: { forced: options.force === true, bindingCount: bindings.length },
          at: timestamp,
        })
        await tx.deleteFrom('vault_items').where('id', '=', item.id).execute()
        await announceVaultItem(tx, userId, key, 'deleted')
        return { status: 'deleted' }
      })
    },

    async delete(userId, key) {
      return (await this.remove(userId, key, { force: true })).status === 'deleted'
    },

    async has(userId, key) {
      return (await metadataFor(db, userId, key)) !== undefined
    },

    async resolveDetailed(userId, key, use = {}) {
      const item = await metadataFor(db, userId, key)
      if (!item) return { status: 'missing' }
      if (item.backend !== 'local-aes') {
        return { status: 'unavailable', itemId: item.id, backend: item.backend }
      }
      const version = await db
        .selectFrom('vault_item_versions')
        .select(['encrypted_payload', 'payload_schema'])
        .where('item_id', '=', item.id)
        .where('version', '=', item.current_version)
        .where('redacted_at', 'is', null)
        .executeTakeFirst()
      if (!version?.encrypted_payload || version.payload_schema !== 'localix.fields.v1') {
        return { status: 'corrupt', itemId: item.id }
      }

      try {
        const value = decryptItemValue(
          await getCipher(),
          userId,
          item.id,
          item.current_version,
          item.field,
          version.encrypted_payload,
        )
        if (value === null) return { status: 'corrupt', itemId: item.id }
        await insertAudit(db, {
          userId,
          itemId: item.id,
          operation: 'use',
          result: 'success',
          actorType: use.actorType,
          actorId: use.actorId,
          consumerType: use.consumerType,
          consumerId: use.consumerId,
          at: now().toISOString(),
        })
        return { status: 'ok', value, itemId: item.id, version: item.current_version }
      } catch {
        await insertAudit(db, {
          userId,
          itemId: item.id,
          operation: 'use',
          result: 'corrupt',
          actorType: use.actorType,
          actorId: use.actorId,
          consumerType: use.consumerType,
          consumerId: use.consumerId,
          at: now().toISOString(),
        })
        return { status: 'corrupt', itemId: item.id }
      }
    },

    async resolve(userId, key, use) {
      const result = await this.resolveDetailed(userId, key, use)
      if (result.status === 'ok') return result.value
      if (result.status === 'missing') return null
      throw new VaultPayloadError(result.itemId, result.status)
    },
  }
}
