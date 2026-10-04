import type { Kysely, Transaction } from 'kysely'

import type { AppDatabase } from '../../db'
import type { SecretCipher } from './cipher'
import {
  secretKeySchema,
  toSecretHandle,
  type SecretMeta,
  type UpdateSecretMetadataRequest,
  type VaultItemSource,
  type VaultItemType,
} from './contracts'
import type { VaultItemMetadata, VaultMutationResult, VaultUseContext } from './store'

interface EncryptedPayloadV1 {
  schema: 1
  fields: Record<string, string>
}

export class VaultPayloadError extends Error {
  readonly itemId: string
  readonly code: 'corrupt' | 'unavailable'

  constructor(itemId: string, code: 'corrupt' | 'unavailable') {
    super(
      code === 'corrupt'
        ? 'Vault item cannot be decrypted'
        : 'Vault item storage backend is unavailable',
    )
    this.itemId = itemId
    this.code = code
    this.name = 'VaultPayloadError'
  }
}

const payloadContext = (userId: string, itemId: string, version: number) =>
  `localix-vault:v1:${userId}:${itemId}:${version}`

export const decryptItemValue = (
  cipher: SecretCipher,
  userId: string,
  itemId: string,
  version: number,
  field: string,
  encryptedPayload: string,
): string | null => {
  const plain = cipher.decrypt(encryptedPayload, payloadContext(userId, itemId, version))
  const payload = JSON.parse(plain) as Partial<EncryptedPayloadV1>
  const value = payload.schema === 1 ? payload.fields?.[field] : undefined
  return typeof value === 'string' ? value : null
}

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

const isUniqueConstraint = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code
  return (
    code === 'SQLITE_CONSTRAINT_UNIQUE' ||
    code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
    (error instanceof Error && /UNIQUE constraint failed/i.test(error.message))
  )
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

export const createItem = async (
  db: Kysely<AppDatabase>,
  getCipher: () => Promise<SecretCipher>,
  now: () => Date,
  id: () => string,
  userId: string,
  key: string,
  value: string,
  metadata: VaultItemMetadata,
): Promise<SecretMeta | null> => {
  const cipher = await getCipher()
  const itemId = id()
  const versionId = id()
  const timestamp = now().toISOString()
  const payload: EncryptedPayloadV1 = { schema: 1, fields: { value } }
  const encrypted = cipher.encrypt(JSON.stringify(payload), payloadContext(userId, itemId, 1))

  try {
    return await db.transaction().execute(async (tx) => {
      await tx
        .insertInto('vault_items')
        .values({
          id: itemId,
          user_id: userId,
          kind: metadata.type ?? 'secret',
          name: metadata.label?.trim() || key,
          description: metadata.description?.trim() || '',
          folder_id: null,
          backend: metadata.backend ?? 'local-aes',
          external_ref: null,
          source: metadata.source ?? 'user',
          schema_version: 1,
          current_version: 1,
          favorite: 0,
          tags_json: JSON.stringify(metadata.tags ?? []),
          created_at: timestamp,
          updated_at: timestamp,
          deleted_at: null,
        })
        .execute()
      await tx
        .insertInto('vault_item_versions')
        .values({
          id: versionId,
          item_id: itemId,
          version: 1,
          encrypted_payload: encrypted,
          payload_ref: null,
          payload_schema: 'localix.fields.v1',
          reason: 'created',
          created_at: timestamp,
          redacted_at: null,
        })
        .execute()
      await tx
        .insertInto('vault_aliases')
        .values({
          user_id: userId,
          alias: key,
          item_id: itemId,
          field: 'value',
          created_at: timestamp,
        })
        .execute()
      await insertAudit(tx, {
        userId,
        itemId,
        operation: 'create',
        result: 'success',
        actorType: metadata.audit?.actorType,
        actorId: metadata.audit?.actorId,
        consumerType: metadata.audit?.consumerType,
        consumerId: metadata.audit?.consumerId,
        at: timestamp,
      })
      const row = await metadataFor(tx, userId, key)
      if (!row) throw new Error('Created Vault item could not be reloaded')
      return toMeta(row)
    })
  } catch (error) {
    if (isUniqueConstraint(error)) return null
    throw error
  }
}

export const rotateItem = async (
  db: Kysely<AppDatabase>,
  getCipher: () => Promise<SecretCipher>,
  now: () => Date,
  id: () => string,
  userId: string,
  key: string,
  value: string,
  expectedVersion: number,
  audit?: VaultUseContext,
): Promise<VaultMutationResult> => {
  const cipher = await getCipher()
  return db.transaction().execute(async (tx) => {
    const current = await metadataFor(tx, userId, key)
    if (!current) return { status: 'missing' }
    if (current.current_version !== expectedVersion) {
      return { status: 'conflict', currentVersion: current.current_version }
    }

    const nextVersion = expectedVersion + 1
    const timestamp = now().toISOString()
    const payload: EncryptedPayloadV1 = { schema: 1, fields: { value } }
    const encrypted = cipher.encrypt(
      JSON.stringify(payload),
      payloadContext(userId, current.id, nextVersion),
    )

    await tx
      .insertInto('vault_item_versions')
      .values({
        id: id(),
        item_id: current.id,
        version: nextVersion,
        encrypted_payload: encrypted,
        payload_ref: null,
        payload_schema: 'localix.fields.v1',
        reason: 'rotated',
        created_at: timestamp,
        redacted_at: null,
      })
      .execute()
    const update = await tx
      .updateTable('vault_items')
      .set({ current_version: nextVersion, updated_at: timestamp })
      .where('id', '=', current.id)
      .where('current_version', '=', expectedVersion)
      .executeTakeFirst()
    if (Number(update.numUpdatedRows) !== 1) {
      throw new Error('Vault version changed during rotation')
    }
    await insertAudit(tx, {
      userId,
      itemId: current.id,
      operation: 'rotate',
      result: 'success',
      actorType: audit?.actorType,
      actorId: audit?.actorId,
      consumerType: audit?.consumerType,
      consumerId: audit?.consumerId,
      at: timestamp,
    })
    const row = await metadataFor(tx, userId, key)
    if (!row) throw new Error('Rotated Vault item could not be reloaded')
    return { status: 'updated', item: toMeta(row) }
  })
}

export const updateItemMetadata = async (
  db: Kysely<AppDatabase>,
  getCipher: () => Promise<SecretCipher>,
  now: () => Date,
  id: () => string,
  userId: string,
  key: string,
  request: UpdateSecretMetadataRequest,
  audit?: VaultUseContext,
): Promise<VaultMutationResult> => {
  const cipher = await getCipher()
  return db.transaction().execute(async (tx) => {
    const current = await metadataFor(tx, userId, key)
    if (!current) return { status: 'missing' }
    if (current.current_version !== request.expectedVersion) {
      return { status: 'conflict', currentVersion: current.current_version }
    }

    const currentPayload = await tx
      .selectFrom('vault_item_versions')
      .select(['encrypted_payload', 'payload_schema'])
      .where('item_id', '=', current.id)
      .where('version', '=', current.current_version)
      .where('redacted_at', 'is', null)
      .executeTakeFirst()
    if (
      !currentPayload?.encrypted_payload ||
      currentPayload.payload_schema !== 'localix.fields.v1'
    ) {
      throw new VaultPayloadError(current.id, 'corrupt')
    }

    let payload: EncryptedPayloadV1
    try {
      const plain = cipher.decrypt(
        currentPayload.encrypted_payload,
        payloadContext(userId, current.id, current.current_version),
      )
      const parsed = JSON.parse(plain) as Partial<EncryptedPayloadV1>
      if (parsed.schema !== 1 || !parsed.fields || typeof parsed.fields !== 'object') {
        throw new Error('invalid payload')
      }
      payload = { schema: 1, fields: parsed.fields }
    } catch {
      throw new VaultPayloadError(current.id, 'corrupt')
    }

    const nextVersion = request.expectedVersion + 1
    const timestamp = now().toISOString()
    const encrypted = cipher.encrypt(
      JSON.stringify(payload),
      payloadContext(userId, current.id, nextVersion),
    )
    await tx
      .insertInto('vault_item_versions')
      .values({
        id: id(),
        item_id: current.id,
        version: nextVersion,
        encrypted_payload: encrypted,
        payload_ref: null,
        payload_schema: 'localix.fields.v1',
        reason: 'metadata_updated',
        created_at: timestamp,
        redacted_at: null,
      })
      .execute()
    const update = await tx
      .updateTable('vault_items')
      .set({
        current_version: nextVersion,
        updated_at: timestamp,
        ...(request.title !== undefined ? { name: request.title } : {}),
        ...(request.description !== undefined ? { description: request.description } : {}),
        ...(request.type !== undefined ? { kind: request.type } : {}),
        ...(request.tags !== undefined ? { tags_json: JSON.stringify(request.tags) } : {}),
      })
      .where('id', '=', current.id)
      .where('current_version', '=', request.expectedVersion)
      .executeTakeFirst()
    if (Number(update.numUpdatedRows) !== 1) {
      throw new Error('Vault version changed during metadata update')
    }
    await insertAudit(tx, {
      userId,
      itemId: current.id,
      operation: 'update_metadata',
      result: 'success',
      actorType: audit?.actorType,
      actorId: audit?.actorId,
      consumerType: audit?.consumerType,
      consumerId: audit?.consumerId,
      context: {
        fields: ['title', 'description', 'type', 'tags'].filter(
          (field) => request[field as keyof UpdateSecretMetadataRequest] !== undefined,
        ),
      },
      at: timestamp,
    })
    const row = await metadataFor(tx, userId, key)
    if (!row) throw new Error('Updated Vault item could not be reloaded')
    return { status: 'updated', item: toMeta(row) }
  })
}
