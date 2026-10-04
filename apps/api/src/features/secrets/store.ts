import { randomUUID } from 'node:crypto'
import path from 'node:path'

import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { localixHome } from '../../lib/env'
import type {
  CreateSecretRequest,
  SecretMeta,
  UpdateSecretMetadataRequest,
  VaultAuditEntry,
  VaultItemSource,
  VaultItemType,
  VaultVersionMeta,
} from './contracts'
import { createAesCipher, type SecretCipher } from './cipher'
import { loadOrCreateMasterKey } from './master-key'
import {
  createItem,
  decryptItemValue,
  insertAudit,
  metadataFor,
  rotateItem,
  toMeta,
  updateItemMetadata,
  VaultPayloadError,
} from './store-internals'

export { defaultLegacySecretsDir, migrateLegacySecrets } from './legacy-migration'
export { VaultPayloadError } from './store-internals'

export interface VaultItemMetadata {
  label?: string
  description?: string
  type?: VaultItemType
  source?: VaultItemSource
  tags?: string[]
  backend?: string
  audit?: VaultUseContext
}

export type VaultResolution =
  | { status: 'ok'; value: string; itemId: string; version: number }
  | { status: 'missing' }
  | { status: 'corrupt'; itemId: string }
  | { status: 'unavailable'; itemId: string; backend: string }

export type VaultMutationResult =
  | { status: 'updated'; item: SecretMeta }
  | { status: 'missing' }
  | { status: 'conflict'; currentVersion: number }

export interface VaultBinding {
  consumerType: string
  consumerId: string
  field: string
  label: string
}

export type VaultDeleteResult =
  | { status: 'deleted' }
  | { status: 'missing' }
  | { status: 'conflict'; currentVersion: number }
  | { status: 'in_use'; bindings: VaultBinding[] }

export interface VaultUseContext {
  actorType?: 'user' | 'agent' | 'plugin' | 'system'
  actorId?: string
  consumerType?: string
  consumerId?: string
}

export interface SecretsStore {
  list(userId: string): Promise<SecretMeta[]>
  listVersions(userId: string, key: string): Promise<VaultVersionMeta[]>
  listAudit(userId: string, limit?: number): Promise<VaultAuditEntry[]>
  create(userId: string, request: CreateSecretRequest): Promise<SecretMeta | null>
  rotate(
    userId: string,
    key: string,
    value: string,
    expectedVersion: number,
    audit?: VaultUseContext,
  ): Promise<VaultMutationResult>
  updateMetadata(
    userId: string,
    key: string,
    request: UpdateSecretMetadataRequest,
    audit?: VaultUseContext,
  ): Promise<VaultMutationResult>
  /**
   * Trusted managed-item upsert used by provider adapters. Public UI writes use
   * create/rotate so an existing credential is never replaced accidentally.
   */
  set(userId: string, key: string, value: string, metadata?: VaultItemMetadata): Promise<SecretMeta>
  setIfAbsent(
    userId: string,
    key: string,
    value: string,
    metadata?: VaultItemMetadata,
  ): Promise<boolean>
  remove(
    userId: string,
    key: string,
    options?: { expectedVersion?: number; force?: boolean; audit?: VaultUseContext },
  ): Promise<VaultDeleteResult>
  /** Trusted lifecycle delete (provider connection removal). */
  delete(userId: string, key: string): Promise<boolean>
  has(userId: string, key: string): Promise<boolean>
  resolveDetailed(userId: string, key: string, use?: VaultUseContext): Promise<VaultResolution>
  /** SERVER-INTERNAL. Never expose the returned value through routes/tools/events. */
  resolve(userId: string, key: string, use?: VaultUseContext): Promise<string | null>
  listBindings(userId: string, key: string): Promise<VaultBinding[]>
  bind(userId: string, key: string, binding: VaultBinding): Promise<boolean>
}

/** Narrow value-use capability for trusted adapters. */
export type SecretsResolver = Pick<SecretsStore, 'resolve' | 'has'>

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
