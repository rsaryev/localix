import type { Kysely } from 'kysely'

import type { AppDatabase, KeyAuthType } from '../../db'

/** The keys of a provider connection: its credentials' rows, in priority order. */

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
  /** What an API key's connection names besides it (`AWS_REGION`, …); never a secret. */
  settings?: Record<string, string>
  vaultItemId: string | null
  priority: number
  enabled: boolean
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

export function createProviderKeysRepository(db: Kysely<AppDatabase>) {
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

  return {
    loadKeysByConnections,
    methods: {
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
    },
  }
}
