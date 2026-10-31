import {
  ForbiddenError,
  InternalError,
  InvalidRequestError,
  NotFoundError,
} from '../../lib/domain-errors'
import { randomUUID } from 'node:crypto'

import type { Kysely } from 'kysely'
import type {
  AgentRuntimeAuth,
  RuntimeCredential,
  RuntimeCredentialInfo,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import type { AppDatabase } from '../../db'
import type {
  AddProviderKeyRequest,
  CompleteOAuthRequest,
  CreateProviderConnectionRequest,
  InitiateOAuthRequest,
  ProviderConnection,
  ProviderConnectionKey,
  UpdateProviderConnectionRequest,
  UpdateProviderKeyRequest,
} from './contracts'
import {
  createProviderConnectionsRepository,
  type ProviderConnectionKeyRecord,
  type ProviderConnectionRecord,
} from './repository'
import { apiKeyCredential, cleanSettings } from './connection-settings'
import { credentialSecrets, decodeCredential } from './stored-credential'
import { toDto } from './mappers'
import { createKeyedSerializer } from '../../lib/keyed-serializer'
import { createOAuthFlowManager } from './oauth-flow-manager'
import {
  refreshFailureReason,
  type ProviderCredentialEvent,
} from '../notifications/conditions/providers'
import { onDeviceFirst } from '@localixai/agent/catalog'

export interface ProviderConnectionsServiceDeps {
  db: Kysely<AppDatabase>
  /** A connection or key was added, changed or removed. */
  onChanged?: () => void
  /** The setting names the catalog asks the provider for; undefined when it is not listed. */
  settingNamesFor?: (providerId: string) => Promise<readonly string[] | undefined>
  /**
   * Called with every provider secret this service DECRYPTS — the API key, and both halves of an
   * OAuth credential. The host uses it to register the value with the vault exposure shield, so a
   * provider error body that echoes the key back is redacted before it is persisted or streamed.
   *
   * It was the missing registration: the shield's two `remember` call sites cover plugin config and
   * the chat runtime's `resolveSecret`, while provider credentials — the ones every model request
   * carries — were resolved straight from the vault and never registered at all.
   */
  onCredentialResolved?: (userId: string, value: string) => void
  /** Each OAuth refresh's outcome (and each new sign-in, as a success) — the host keeps a
   *  connection that cannot renew as a standing Event Center row. */
  onCredentialRefresh?: (event: ProviderCredentialEvent) => void
  createAuthRuntime?: (store: RuntimeCredentialStore) => AgentRuntimeAuth
  credentialVault?: {
    set(
      userId: string,
      key: string,
      value: string,
      metadata?: {
        label?: string
        type?: 'api_key' | 'oauth'
        source?: 'provider'
        tags?: string[]
        audit?: {
          actorType?: 'system'
          actorId?: string
          consumerType?: string
          consumerId?: string
        }
      },
    ): Promise<{ id?: string } | void>
    resolve(
      userId: string,
      key: string,
      use?: {
        actorType?: 'system'
        actorId?: string
        consumerType?: string
        consumerId?: string
      },
    ): Promise<string | null>
    delete(userId: string, key: string): Promise<boolean>
    bind?(
      userId: string,
      key: string,
      binding: {
        consumerType: string
        consumerId: string
        field: string
        label: string
      },
    ): Promise<boolean>
  }
  now?: () => string
}

const toOptionalIsoExpiry = (expiresAt: number): string | null => {
  if (!Number.isFinite(expiresAt)) return null
  const expiry = new Date(expiresAt)
  return Number.isNaN(expiry.getTime()) ? null : expiry.toISOString()
}

export function createProviderConnectionsService(deps: ProviderConnectionsServiceDeps) {
  const repo = createProviderConnectionsRepository(deps.db)
  const now = deps.now ?? (() => new Date().toISOString())
  // Serialize OAuth refresh per connection: concurrent runs must not both refresh
  // the same key — for providers whose refresh tokens ROTATE (single-use), the
  // second refresh would use an already-consumed token and fail.
  const refreshSerializer = createKeyedSerializer()

  const volatileCredentials = new Map<string, string>()
  const vault =
    deps.credentialVault ??
    ({
      async set(userId: string, key: string, value: string) {
        volatileCredentials.set(`${userId}:${key}`, value)
      },
      async resolve(userId: string, key: string) {
        return volatileCredentials.get(`${userId}:${key}`) ?? null
      },
      async delete(userId: string, key: string) {
        return volatileCredentials.delete(`${userId}:${key}`)
      },
    } satisfies NonNullable<ProviderConnectionsServiceDeps['credentialVault']>)
  const vaultKey = (keyId: string) => `provider.${keyId}`

  const readCredential = async (
    userId: string,
    keyId: string,
  ): Promise<RuntimeCredential | undefined> => {
    const encoded = await vault.resolve(userId, vaultKey(keyId), {
      actorType: 'system',
      actorId: 'provider-runtime',
      consumerType: 'provider',
      consumerId: keyId,
    })
    const credential = encoded ? decodeCredential(encoded) : undefined
    // Register EVERY decrypted value, once per read. This covers every READ (DTO hydration and the
    // runtime store's read/list/modify) without those five call sites each remembering to;
    // `writeCredential` covers the other direction, since a token `modify` refreshes is handed
    // straight back to the caller and never re-read before it is used.
    for (const value of credential ? credentialSecrets(credential) : [])
      deps.onCredentialResolved?.(userId, value)
    return credential
  }

  const writeCredential = async (
    userId: string,
    keyId: string,
    credential: RuntimeCredential,
  ): Promise<void> => {
    // Registered on the WRITE path too: `modify` returns the REFRESHED pair, which authenticates
    // from that moment on and is never re-read first — a rotated refresh token must not be echoed.
    for (const value of credentialSecrets(credential)) deps.onCredentialResolved?.(userId, value)
    const alias = vaultKey(keyId)
    const item = await vault.set(userId, alias, JSON.stringify(credential), {
      label: credential.type === 'oauth' ? 'Provider OAuth credential' : 'Provider API key',
      type: credential.type === 'oauth' ? 'oauth' : 'api_key',
      source: 'provider',
      tags: ['provider'],
      audit: {
        actorType: 'system',
        actorId: 'provider-runtime',
        consumerType: 'provider',
        consumerId: keyId,
      },
    })
    const itemId =
      item && typeof item === 'object' && 'id' in item && typeof item.id === 'string'
        ? item.id
        : null
    if (itemId) await repo.setKeyVaultItem(userId, keyId, itemId)
    await vault.bind?.(userId, alias, {
      consumerType: 'provider',
      consumerId: keyId,
      field: 'value',
      label: 'Agent provider credential',
    })
  }

  /** The settings a connection's keys carry: read from its first key, which every key shares. */
  const settingsOfKeys = async (
    userId: string,
    keys: readonly { id: string }[],
  ): Promise<Record<string, string> | undefined> => {
    const first = keys[0]
    if (!first) return undefined
    const credential = await readCredential(userId, first.id).catch(() => undefined)
    return credential?.type === 'api-key' ? credential.env : undefined
  }

  const hydrateConnection = async (
    record: ProviderConnectionRecord,
  ): Promise<ProviderConnectionRecord> => {
    const hydrated = await Promise.all(
      record.keys.map(async (key): Promise<ProviderConnectionKeyRecord | null> => {
        try {
          const credential = await readCredential(record.userId, key.id)
          if (!credential) return null
          return credential.type === 'api-key'
            ? {
                ...key,
                apiKey: credential.key ?? '',
                authType: 'api-key' as const,
                ...(credential.env ? { settings: { ...credential.env } } : {}),
              }
            : {
                ...key,
                apiKey: credential.accessToken,
                authType: 'oauth' as const,
                refreshToken: credential.refreshToken,
                expiresAt: toOptionalIsoExpiry(credential.expiresAt),
                credentialExtra: { ...credential.extra },
              }
        } catch {
          // Vault corruption/unavailability belongs to this credential, not API
          // readiness. Exclude it from the public/runtime view; raw metadata remains
          // in the repository so the connection can still be replaced or deleted.
          return null
        }
      }),
    )
    const keys = hydrated.filter((key): key is ProviderConnectionKeyRecord => key !== null)
    return {
      ...record,
      apiKey: keys[0]?.apiKey ?? '',
      keys,
    }
  }

  const requireRawConnectionRecord = async (
    userId: string,
    id: string,
  ): Promise<ProviderConnectionRecord> => {
    const record = await repo.getById(userId, id)
    if (!record)
      throw new NotFoundError('provider_connection_not_found', 'Provider connection not found')
    return record
  }

  const requireConnectionRecord = async (
    userId: string,
    id: string,
  ): Promise<ProviderConnectionRecord> =>
    hydrateConnection(await requireRawConnectionRecord(userId, id))

  const requireKeyRecord = async (
    userId: string,
    connectionId: string,
    keyId: string,
  ): Promise<ProviderConnectionKeyRecord> => {
    const key = await repo.getKey(userId, connectionId, keyId)
    if (!key) throw new NotFoundError('provider_key_not_found', 'API key not found')
    return key
  }

  const loadDto = async (userId: string, id: string): Promise<ProviderConnection> =>
    toDto(await requireConnectionRecord(userId, id))

  const staticKey = (args: {
    connectionId: string
    userId: string
    label: string
    apiKey: string
    priority: number
    timestamp: string
  }): ProviderConnectionKeyRecord => ({
    id: randomUUID(),
    connectionId: args.connectionId,
    userId: args.userId,
    label: args.label,
    apiKey: args.apiKey,
    authType: 'api-key',
    refreshToken: null,
    expiresAt: null,
    credentialExtra: {},
    vaultItemId: null,
    priority: args.priority,
    enabled: true,
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  })

  const credentialStoreFor = (
    userId: string,
    providerId: string,
    connectionId: string,
    keyId: string,
  ): RuntimeCredentialStore => ({
    read: (requestedProviderId) =>
      requestedProviderId === providerId
        ? readCredential(userId, keyId)
        : Promise.resolve(undefined),
    async list(): Promise<readonly RuntimeCredentialInfo[]> {
      const credential = await readCredential(userId, keyId)
      return credential ? [{ providerId, type: credential.type }] : []
    },
    modify(requestedProviderId, update) {
      if (requestedProviderId !== providerId) return Promise.resolve(undefined)
      return refreshSerializer(keyId, async () => {
        const current = await readCredential(userId, keyId)
        let next: RuntimeCredential | undefined
        try {
          next = await update(current)
        } catch (error) {
          // The update IS the OAuth refresh: it throwing means this connection cannot sign in.
          const reason = refreshFailureReason(error)
          if (reason !== null) {
            deps.onCredentialRefresh?.({
              userId,
              connectionId,
              label: providerId,
              ok: false,
              error: reason,
            })
          }
          throw error
        }
        if (next !== undefined) {
          await writeCredential(userId, keyId, next)
          await repo.updateKey(userId, connectionId, keyId, { updatedAt: now() })
          deps.onCredentialRefresh?.({ userId, connectionId, label: providerId, ok: true })
        }
        return next ?? current
      })
    },
    async delete(requestedProviderId) {
      if (requestedProviderId === providerId) await vault.delete(userId, vaultKey(keyId))
    },
  })

  const persistOAuthCredential = async (input: {
    userId: string
    providerId: string
    providerName: string
    label: string
    credential: RuntimeCredential
  }): Promise<string> => {
    if (input.credential.type !== 'oauth') throw new Error('OAuth login returned an API key')
    const timestamp = now()
    const existing = (await repo.listByUser(input.userId)).find(
      (connection) =>
        connection.providerId === input.providerId && connection.label === input.label,
    )
    const connectionId = existing?.id ?? randomUUID()
    const priority = existing ? (await repo.maxKeyPriority(connectionId)) + 1 : 0
    const key: ProviderConnectionKeyRecord = {
      id: randomUUID(),
      connectionId,
      userId: input.userId,
      label: priority === 0 ? 'default' : `oauth-${priority + 1}`,
      apiKey: input.credential.accessToken,
      authType: 'oauth',
      refreshToken: input.credential.refreshToken,
      expiresAt: toOptionalIsoExpiry(input.credential.expiresAt),
      credentialExtra: { ...input.credential.extra },
      vaultItemId: null,
      priority,
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    if (!existing) {
      await repo.insert({
        id: connectionId,
        userId: input.userId,
        providerId: input.providerId,
        providerName: input.providerName,
        label: input.label,
        authType: 'oauth-pkce',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
    }

    try {
      await repo.insertKey(key)
      await writeCredential(input.userId, key.id, input.credential)
      if (existing) {
        await repo.update(input.userId, connectionId, {
          providerName: input.providerName,
          authType: 'oauth-pkce',
          updatedAt: timestamp,
        })
      }
      // Signing in again is the fix for a connection whose refresh stopped working.
      const signedIn = { userId: input.userId, connectionId, label: input.providerName, ok: true }
      deps.onCredentialRefresh?.(signedIn)
      await repo.announceUpserted(input.userId, connectionId)
    } catch (error) {
      await Promise.allSettled([
        vault.delete(input.userId, vaultKey(key.id)),
        repo.deleteKey(input.userId, connectionId, key.id),
      ])
      if (!existing) await repo.delete(input.userId, connectionId).catch(() => {})
      throw error
    }
    return connectionId
  }

  const oauthFlows = deps.createAuthRuntime
    ? createOAuthFlowManager({
        createAuth: deps.createAuthRuntime,
        persist: persistOAuthCredential,
      })
    : undefined

  // An unreadable catalog must not stop a connection from being saved: secret names stay refused.
  const allowedFor = (id: string) => deps.settingNamesFor?.(id).catch(() => undefined)

  const createConnectionImpl = async (
    userId: string,
    input: CreateProviderConnectionRequest,
  ): Promise<ProviderConnection> => {
    const timestamp = now()
    const id = randomUUID()
    const seedKeys = [...(input.apiKey ? [input.apiKey] : []), ...(input.apiKeys ?? [])]
    const settings = cleanSettings(input.settings, await allowedFor(input.providerId))
    if (seedKeys.length === 0) {
      throw new InvalidRequestError(
        'provider_connection_no_key',
        'At least one API key is required',
      )
    }

    await repo.insert({
      id,
      userId,
      providerId: input.providerId,
      providerName: input.providerName,
      label: input.label,
      authType: input.authType,
      createdAt: timestamp,
      updatedAt: timestamp,
    })

    let priority = 0
    for (const apiKey of seedKeys) {
      const key = staticKey({
        connectionId: id,
        userId,
        label: priority === 0 ? 'default' : `key-${priority + 1}`,
        apiKey,
        priority,
        timestamp,
      })
      await repo.insertKey(key)
      await writeCredential(userId, key.id, apiKeyCredential(apiKey, settings))
      priority += 1
    }

    // Announced once its keys can be read: a consumer re-reads the connection usable.
    await repo.announceUpserted(userId, id)
    return loadDto(userId, id)
  }

  const service = {
    async listConnections(userId: string): Promise<{ connections: ProviderConnection[] }> {
      const rows = await Promise.all((await repo.listByUser(userId)).map(hydrateConnection))
      return { connections: onDeviceFirst(rows.map(toDto), (c) => c.providerId) }
    },

    createConnection: createConnectionImpl,

    async updateConnection(
      userId: string,
      id: string,
      patch: UpdateProviderConnectionRequest,
    ): Promise<ProviderConnection> {
      const existing = await requireRawConnectionRecord(userId, id)

      // New settings replace the old on every key (checked before any write); else each keeps its own.
      const settings =
        patch.settings !== undefined
          ? cleanSettings(patch.settings, await allowedFor(existing.providerId))
          : await settingsOfKeys(userId, existing.keys)

      const updatedAt = now()
      await repo.update(userId, id, { label: patch.label, updatedAt })
      if (patch.settings !== undefined) {
        for (const key of existing.keys) {
          const credential = await readCredential(userId, key.id).catch(() => undefined)
          if (credential?.type !== 'api-key' || !credential.key) continue
          await writeCredential(userId, key.id, apiKeyCredential(credential.key, settings))
          await repo.updateKey(userId, id, key.id, { updatedAt })
        }
      }

      // Legacy single-key patch: route to the first key so the existing PATCH contract works.
      if (patch.apiKey !== undefined) {
        const first = existing.keys[0]
        if (first) {
          await writeCredential(userId, first.id, apiKeyCredential(patch.apiKey, settings))
          await repo.updateKey(userId, id, first.id, { updatedAt })
        } else {
          const key = staticKey({
            connectionId: id,
            userId,
            label: 'default',
            apiKey: patch.apiKey,
            priority: 0,
            timestamp: updatedAt,
          })
          await repo.insertKey(key)
          await writeCredential(userId, key.id, apiKeyCredential(patch.apiKey, settings))
        }
      }

      await repo.announceUpserted(userId, id)
      return loadDto(userId, id)
    },

    async deleteConnection(userId: string, id: string): Promise<void> {
      const connection = await requireRawConnectionRecord(userId, id)
      await Promise.allSettled(connection.keys.map((key) => vault.delete(userId, vaultKey(key.id))))
      await repo.delete(userId, id)
    },

    // ---- Keys ----------------------------------------------------------------

    async listKeys(userId: string, id: string): Promise<{ keys: ProviderConnectionKey[] }> {
      const dto = await loadDto(userId, id)
      return { keys: dto.keys }
    },

    async addKey(
      userId: string,
      id: string,
      input: AddProviderKeyRequest,
    ): Promise<ProviderConnection> {
      const existing = await requireRawConnectionRecord(userId, id)
      const timestamp = now()
      const nextPriority = (await repo.maxKeyPriority(id)) + 1
      const key = staticKey({
        connectionId: id,
        userId,
        label: input.label ?? `key-${nextPriority + 1}`,
        apiKey: input.apiKey,
        priority: nextPriority,
        timestamp,
      })
      await repo.insertKey(key)
      // A key added later reaches the same region, resource or project as the others.
      const settings = await settingsOfKeys(userId, existing.keys)
      await writeCredential(userId, key.id, apiKeyCredential(input.apiKey, settings))
      await repo.announceUpserted(userId, id)
      return loadDto(userId, id)
    },

    async updateKey(
      userId: string,
      id: string,
      keyId: string,
      patch: UpdateProviderKeyRequest,
    ): Promise<ProviderConnection> {
      const connection = await requireConnectionRecord(userId, id)
      await requireKeyRecord(userId, id, keyId)

      // Don't allow disabling the last enabled key — that would orphan the connection.
      if (patch.enabled === false) {
        const enabledCount = connection.keys.filter((k) => k.enabled).length
        if (enabledCount <= 1) {
          throw new InvalidRequestError(
            'provider_key_last_enabled',
            'Cannot disable the only enabled key',
          )
        }
      }

      await repo.updateKey(userId, id, keyId, { ...patch, updatedAt: now() })
      await repo.announceUpserted(userId, id)
      return loadDto(userId, id)
    },

    async removeKey(userId: string, id: string, keyId: string): Promise<ProviderConnection> {
      const connection = await requireConnectionRecord(userId, id)
      await requireKeyRecord(userId, id, keyId)
      if (connection.keys.length <= 1) {
        throw new InvalidRequestError(
          'provider_key_last',
          'Cannot remove the only key; delete the connection instead',
        )
      }
      await repo.deleteKey(userId, id, keyId)
      await vault.delete(userId, vaultKey(keyId))
      await repo.announceUpserted(userId, id)
      return loadDto(userId, id)
    },

    async initiateOAuth(userId: string, input: InitiateOAuthRequest) {
      if (!oauthFlows) {
        throw new InvalidRequestError(
          'oauth_provider_unsupported',
          'OAuth runtime is not configured',
        )
      }
      return oauthFlows.begin({
        userId,
        providerId: input.providerId,
        providerName: input.providerName,
        label: input.label,
      })
    },

    async completeOAuth(userId: string, input: CompleteOAuthRequest): Promise<ProviderConnection> {
      try {
        if (!oauthFlows) throw new Error('oauth_state_not_found')
        const connectionId = await oauthFlows.complete(userId, input.state, input.code)
        return loadDto(userId, connectionId)
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'unknown'
        if (msg === 'oauth_state_not_found' || msg === 'oauth_state_expired') {
          throw new InvalidRequestError('oauth_state_invalid', 'OAuth state is invalid or expired')
        }
        if (msg === 'oauth_state_user_mismatch') {
          throw new ForbiddenError(
            'oauth_state_user_mismatch',
            'OAuth state belongs to a different user',
          )
        }
        throw new InternalError(
          'oauth_key_exchange_failed',
          err instanceof Error ? err.message : 'OAuth login failed',
        )
      }
    },

    requireConnection: requireConnectionRecord,

    credentialStoreFor(userId: string, connectionId: string, keyId: string) {
      return requireRawConnectionRecord(userId, connectionId).then((connection) =>
        credentialStoreFor(userId, connection.providerId, connectionId, keyId),
      )
    },

    /** Cancel pending interactive provider logins during process teardown. */
    dispose(): void {
      oauthFlows?.dispose()
      volatileCredentials.clear()
    },
  }
  // Anything that adds, changes or removes a connection or a key changes what can be listed from
  // it (a provider's embedding models): the host hears once each settles.
  for (const name of CHANGES) {
    const call = service[name] as (...args: never[]) => Promise<unknown>
    ;(service as Record<string, unknown>)[name] = async (...args: never[]) => {
      const result = await call(...args)
      deps.onChanged?.()
      return result
    }
  }
  return service
}

/** The mutations `onChanged` follows. */
const CHANGES = [
  'createConnection',
  'updateConnection',
  'deleteConnection',
  'addKey',
  'updateKey',
  'removeKey',
  'completeOAuth',
] as const

export type ProviderConnectionsService = ReturnType<typeof createProviderConnectionsService>
