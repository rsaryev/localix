import path from 'node:path'
import { readFile, readdir, rename } from 'node:fs/promises'

import type { Kysely } from 'kysely'

import type { AppDatabase } from '../../db'
import { localixHome } from '../../lib/env'
import { createAesCipher, type SecretCipher } from './cipher'
import { loadOrCreateMasterKey } from './master-key'
import type { VaultItemType } from './contracts'
import type { SecretsStore, VaultItemMetadata } from './store'

/** Read-only source used by the typed-vault upgrade. */
export function defaultLegacySecretsDir(): string {
  return path.join(localixHome(), 'secrets')
}

interface LegacyStoredSecret {
  v: string
  createdAt: number
  updatedAt: number
}

function legacyProviderAlias(key: string): {
  alias: string
  keyId: string
} | null {
  const prefix = 'provider-credential:'
  if (!key.startsWith(prefix) || key.length === prefix.length) return null
  const keyId = key.slice(prefix.length)
  return { alias: `provider.${keyId}`, keyId }
}

function legacyMetadata(
  key: string,
  value: string,
): {
  alias: string
  keyId?: string
  metadata: VaultItemMetadata
} {
  const provider = legacyProviderAlias(key)
  if (!provider) {
    return {
      alias: key,
      metadata: { label: key, type: 'secret', source: 'user', tags: ['legacy-import'] },
    }
  }

  let type: VaultItemType = 'api_key'
  try {
    const parsed = JSON.parse(value) as { type?: unknown }
    if (parsed.type === 'oauth') type = 'oauth'
  } catch {
    // Provider credential validation remains owned by the provider adapter. The
    // importer only assigns safe metadata around the opaque legacy value.
  }
  return {
    alias: provider.alias,
    keyId: provider.keyId,
    metadata: {
      label: type === 'oauth' ? 'Provider OAuth credential' : 'Provider API key',
      type,
      source: 'provider',
      tags: ['provider', 'legacy-import'],
    },
  }
}

/**
 * Import the pre-typed-vault encrypted JSON files once, then archive each source
 * file beside itself. The archive makes the operation recoverable while ensuring
 * a deleted typed item is never resurrected by a later restart.
 *
 * Each file is archived only after every entry has been decrypted and copied.
 * A crash or malformed value leaves the original `.json` intact, and retries are
 * safe because aliases are create-only.
 */
export async function migrateLegacySecrets(options: {
  db: Kysely<AppDatabase>
  store: SecretsStore
  legacyDir?: string
  cipher?: SecretCipher
}): Promise<number> {
  const legacyDir = options.legacyDir ?? defaultLegacySecretsDir()
  let names: string[]
  try {
    names = (await readdir(legacyDir)).filter((name) => name.endsWith('.json')).sort()
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return 0
    throw error
  }
  if (names.length === 0) return 0

  const cipher = options.cipher ?? createAesCipher(await loadOrCreateMasterKey(legacyDir))
  let imported = 0

  for (const name of names) {
    const source = path.join(legacyDir, name)
    const userId = name.slice(0, -'.json'.length)
    const raw = await readFile(source, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Legacy secrets file ${source} does not hold a key-to-secret object`)
    }

    for (const [legacyKey, unknownEntry] of Object.entries(parsed)) {
      const entry = unknownEntry as Partial<LegacyStoredSecret>
      if (
        typeof entry.v !== 'string' ||
        typeof entry.createdAt !== 'number' ||
        typeof entry.updatedAt !== 'number'
      ) {
        throw new Error(`Legacy secrets file ${source} contains an invalid entry`)
      }
      const value = cipher.decrypt(entry.v)
      const target = legacyMetadata(legacyKey, value)
      const created = await options.store.setIfAbsent(userId, target.alias, value, target.metadata)
      if (created) imported += 1

      if (target.keyId) {
        const item = await options.db
          .selectFrom('vault_aliases')
          .select('item_id')
          .where('user_id', '=', userId)
          .where('alias', '=', target.alias)
          .executeTakeFirst()
        if (item) {
          await options.db
            .updateTable('provider_connection_keys')
            .set({ vault_item_id: item.item_id })
            .where('user_id', '=', userId)
            .where('id', '=', target.keyId)
            .execute()
          await options.store.bind(userId, target.alias, {
            consumerType: 'provider',
            consumerId: target.keyId,
            field: 'value',
            label: 'Agent provider credential',
          })
        }
      }
    }

    await rename(source, `${source}.migrated`)
  }

  return imported
}
