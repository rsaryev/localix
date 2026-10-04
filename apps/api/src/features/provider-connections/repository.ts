import type { Kysely } from 'kysely'

import type { AppDatabase, KeyAuthType } from '../../db'

export interface ProviderConnectionKeyRecord {
  id: string
  connectionId: string
  userId: string
  label: string
  /** For OAuth keys this is the current access token. */
  apiKey: string
  authType: KeyAuthType
  refreshToken: string | null
  /** ISO timestamp; null for static keys. */
  expiresAt: string | null
  credentialExtra: Record<string, unknown>
  vaultItemId: string | null
  priority: number
  enabled: boolean
  createdAt: string
  updatedAt: string
}

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

const mapKeyRow = (row: {
  id: string
  connection_id: string
  user_id: string
  label: string
  credential_type: KeyAuthType | null
  vault_item_id: string | null
  priority: number
  enabled: number
  created_at: string
  updated_at: string
}): ProviderConnectionKeyRecord => ({
  id: row.id,
  connectionId: row.connection_id,
  userId: row.user_id,
  label: row.label,
  apiKey: '',
  authType: row.credential_type ?? 'api-key',
  refreshToken: null,
  expiresAt: null,
  credentialExtra: {},
  vaultItemId: row.vault_item_id,
  priority: row.priority,
  enabled: row.enabled !== 0,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export function createProviderConnectionsRepository(db: Kysely<AppDatabase>) {
  const loadKeysByConnections = async (
    connectionIds: string[],
  ): Promise<Map<string, ProviderConnectionKeyRecord[]>> => {
    const map = new Map<string, ProviderConnectionKeyRecord[]>()
    if (connectionIds.length === 0) return map
    const rows = await db
      .selectFrom('provider_connection_keys')
      .selectAll()
      .where('connection_id', 'in', connectionIds)
      .orderBy('priority', 'asc')
      .orderBy('created_at', 'asc')
      .execute()
    for (const row of rows) {
      const rec = mapKeyRow(row)
      const list = map.get(rec.connectionId) ?? []
      list.push(rec)
      map.set(rec.connectionId, list)
    }
    return map
  }

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

    async delete(userId: string, id: string): Promise<void> {
      await db
        .deleteFrom('provider_connections')
        .where('user_id', '=', userId)
        .where('id', '=', id)
        .execute()
    },

    // ---- Keys --------------------------------------------------------------

    async listKeys(connectionId: string): Promise<ProviderConnectionKeyRecord[]> {
      return (await loadKeysByConnections([connectionId])).get(connectionId) ?? []
    },

    async insertKey(input: ProviderConnectionKeyRecord): Promise<void> {
      await db
        .insertInto('provider_connection_keys')
        .values({
          id: input.id,
          connection_id: input.connectionId,
          user_id: input.userId,
          label: input.label,
          credential_type: input.authType,
          vault_item_id: input.vaultItemId,
          priority: input.priority,
          enabled: input.enabled ? 1 : 0,
          created_at: input.createdAt,
          updated_at: input.updatedAt,
        })
        .execute()
    },

    async getKey(
      userId: string,
      connectionId: string,
      keyId: string,
    ): Promise<ProviderConnectionKeyRecord | null> {
      const row = await db
        .selectFrom('provider_connection_keys')
        .selectAll()
        .where('user_id', '=', userId)
        .where('connection_id', '=', connectionId)
        .where('id', '=', keyId)
        .executeTakeFirst()
      return row ? mapKeyRow(row) : null
    },

    async updateKey(
      userId: string,
      connectionId: string,
      keyId: string,
      patch: {
        label?: string
        apiKey?: string
        refreshToken?: string | null
        expiresAt?: string | null
        credentialExtra?: Record<string, unknown>
        vaultItemId?: string | null
        priority?: number
        enabled?: boolean
        updatedAt?: string
      },
    ): Promise<void> {
      await db
        .updateTable('provider_connection_keys')
        .set({
          ...(patch.label !== undefined ? { label: patch.label } : {}),
          ...(patch.priority !== undefined ? { priority: patch.priority } : {}),
          ...(patch.enabled !== undefined ? { enabled: patch.enabled ? 1 : 0 } : {}),
          ...(patch.vaultItemId !== undefined ? { vault_item_id: patch.vaultItemId } : {}),
          ...(patch.updatedAt !== undefined ? { updated_at: patch.updatedAt } : {}),
        })
        .where('user_id', '=', userId)
        .where('connection_id', '=', connectionId)
        .where('id', '=', keyId)
        .execute()
    },

    async setKeyVaultItem(userId: string, keyId: string, vaultItemId: string): Promise<void> {
      await db
        .updateTable('provider_connection_keys')
        .set({ vault_item_id: vaultItemId })
        .where('user_id', '=', userId)
        .where('id', '=', keyId)
        .execute()
    },

    async deleteKey(userId: string, connectionId: string, keyId: string): Promise<void> {
      await db
        .deleteFrom('provider_connection_keys')
        .where('user_id', '=', userId)
        .where('connection_id', '=', connectionId)
        .where('id', '=', keyId)
        .execute()
    },

    async maxKeyPriority(connectionId: string): Promise<number> {
      const row = await db
        .selectFrom('provider_connection_keys')
        .select((eb) => eb.fn.max('priority').as('maxPriority'))
        .where('connection_id', '=', connectionId)
        .executeTakeFirst()
      return Number(row?.maxPriority ?? -1)
    },
  }
}
