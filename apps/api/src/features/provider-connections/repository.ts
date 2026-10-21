import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { recordCoreChanges } from '../changes/core-entities'
import { createProviderKeysRepository, type ProviderConnectionKeyRecord } from './key-repository'

export type { ProviderConnectionKeyRecord } from './key-repository'

export interface ProviderConnectionRecord {
  id: string
  userId: string
  providerId: string
  providerName: string
  label: string
  authType: 'api-key' | 'oauth-pkce'
  /** Legacy single key (kept as defensive fallback); prefer `keys`. */
  apiKey: string
  keys: ProviderConnectionKeyRecord[]
  createdAt: string
  updatedAt: string
}

export function createProviderConnectionsRepository(db: Kysely<AppDatabase>) {
  const keys = createProviderKeysRepository(db)
  const loadKeysByConnections = keys.loadKeysByConnections

  const mapConnection = (
    row: {
      id: string
      user_id: string
      provider_id: string
      provider_name: string
      label: string
      auth_type: 'api-key' | 'oauth-pkce'
      created_at: string
      updated_at: string
    },
    keys: ProviderConnectionKeyRecord[],
  ): ProviderConnectionRecord => ({
    id: row.id,
    userId: row.user_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    label: row.label,
    authType: row.auth_type,
    apiKey: '',
    keys,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })

  return {
    async listByUser(userId: string): Promise<ProviderConnectionRecord[]> {
      const rows = await db
        .selectFrom('provider_connections')
        .selectAll()
        .where('user_id', '=', userId)
        .orderBy('updated_at', 'desc')
        .execute()

      const keysByConn = await loadKeysByConnections(rows.map((r) => r.id))
      return rows.map((row) => mapConnection(row, keysByConn.get(row.id) ?? []))
    },

    async getById(userId: string, id: string): Promise<ProviderConnectionRecord | null> {
      const row = await db
        .selectFrom('provider_connections')
        .selectAll()
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()

      if (!row) return null
      const keysByConn = await loadKeysByConnections([row.id])
      return mapConnection(row, keysByConn.get(row.id) ?? [])
    },

    async insert(input: {
      id: string
      userId: string
      providerId: string
      providerName: string
      label: string
      authType: 'api-key' | 'oauth-pkce'
      createdAt: string
      updatedAt: string
    }): Promise<void> {
      await db
        .insertInto('provider_connections')
        .values({
          id: input.id,
          user_id: input.userId,
          provider_id: input.providerId,
          provider_name: input.providerName,
          label: input.label,
          auth_type: input.authType,
          status: 'active',
          created_at: input.createdAt,
          updated_at: input.updatedAt,
        })
        .execute()
    },

    async update(
      userId: string,
      id: string,
      patch: {
        providerName?: string
        label?: string
        authType?: 'api-key' | 'oauth-pkce'
        updatedAt?: string
      },
    ): Promise<void> {
      await db
        .updateTable('provider_connections')
        .set({
          ...(patch.providerName !== undefined ? { provider_name: patch.providerName } : {}),
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.authType !== undefined ? { auth_type: patch.authType } : {}),
          ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
        })
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .execute()
    },

    /** Delete the connection and announce it in the same transaction. */
    async delete(userId: string, id: string): Promise<void> {
      await db.transaction().execute(async (trx) => {
        const row = await trx
          .deleteFrom('provider_connections')
          .where('user_id', '=', userId)
          .where('id', '=', id)
          .returning('provider_id')
          .executeTakeFirst()
        if (!row) return
        const ref = { id, userId, providerId: row.provider_id }
        await recordCoreChanges(trx, { entity: 'provider.connection', op: 'deleted', ref })
      })
    },

    /** Announce that the connection can serve differently now: created, signed in, key enabled. */
    async announceUpserted(userId: string, id: string): Promise<void> {
      const row = await db
        .selectFrom('provider_connections')
        .select('provider_id')
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .executeTakeFirst()
      if (!row) return
      const ref = { id, userId, providerId: row.provider_id }
      await recordCoreChanges(db, { entity: 'provider.connection', op: 'upserted', ref })
    },

    ...keys.methods,
  }
}
