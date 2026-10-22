import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import type {
  AgentRuntimeAuth,
  RuntimeCredential,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsService } from './service'

const tempDir = join(process.cwd(), 'tmp', 'provider-connections-service-tests')
const permanentOAuthCredential: RuntimeCredential = {
  type: 'oauth',
  accessToken: 'sk-or-v1-test',
  refreshToken: '',
  expiresAt: Number.MAX_SAFE_INTEGER,
}

const createAuthRuntime = (_store: RuntimeCredentialStore): AgentRuntimeAuth => ({
  listProviders: () => [],
  logout: async () => {},
  async login(_providerId, _type, interaction) {
    void interaction.notify({ type: 'auth-url', url: 'https://provider.example/login' })
    await interaction.prompt({ type: 'manual-code', message: 'Authorization code' })
    return permanentOAuthCredential
  },
})

describe('provider connection OAuth persistence', () => {
  let db: ReturnType<typeof createDatabase>
  const credentials = new Map<string, string>()
  const credentialVault = {
    async set(userId: string, key: string, value: string) {
      if (userId.startsWith('failing-')) throw new Error('vault unavailable')
      credentials.set(`${userId}:${key}`, value)
    },
    async resolve(userId: string, key: string) {
      return credentials.get(`${userId}:${key}`) ?? null
    },
    async delete(userId: string, key: string) {
      return credentials.delete(`${userId}:${key}`)
    },
  }

  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
    db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(tempDir, { recursive: true, force: true })
  })

  test('stores a permanent OAuth API key without inventing an invalid expiry date', async () => {
    let timestamp = Date.parse('2026-07-19T00:00:00.000Z')
    const service = createProviderConnectionsService({
      db,
      createAuthRuntime,
      credentialVault,
      now: () => new Date(timestamp++).toISOString(),
    })
    const started = await service.initiateOAuth('openrouter-user', {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      label: 'OpenRouter',
      callbackUrl: 'http://localhost/oauth/callback',
    })
    const connection = await service.completeOAuth('openrouter-user', {
      state: started.state,
      code: 'oauth-code',
    })

    expect(connection).toMatchObject({
      providerId: 'openrouter',
      authType: 'oauth-pkce',
      hasApiKey: true,
      keyCount: 1,
    })
    const record = await service.requireConnection('openrouter-user', connection.id)
    expect(record.keys[0]).toMatchObject({
      apiKey: permanentOAuthCredential.accessToken,
      authType: 'oauth',
      expiresAt: null,
    })
    const store = await service.credentialStoreFor(
      'openrouter-user',
      connection.id,
      record.keys[0]!.id,
    )
    expect(store.read('openrouter')).resolves.toEqual(permanentOAuthCredential)
  })

  test('repairs a zero-key orphan in place and normalizes its OAuth metadata', async () => {
    const orphanId = randomUUID()
    const oldTimestamp = '2026-07-18T00:00:00.000Z'
    await db
      .insertInto('provider_connections')
      .values({
        id: orphanId,
        user_id: 'orphan-user',
        provider_id: 'openrouter',
        provider_name: 'Stale provider name',
        label: 'OpenRouter',
        auth_type: 'api-key',
        status: 'active',
        created_at: oldTimestamp,
        updated_at: oldTimestamp,
      })
      .execute()

    const service = createProviderConnectionsService({ db, createAuthRuntime, credentialVault })
    const started = await service.initiateOAuth('orphan-user', {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      label: 'OpenRouter',
      callbackUrl: 'http://localhost/oauth/callback',
    })
    const repaired = await service.completeOAuth('orphan-user', {
      state: started.state,
      code: 'oauth-code',
    })

    expect(repaired).toMatchObject({
      id: orphanId,
      providerName: 'OpenRouter',
      authType: 'oauth-pkce',
      hasApiKey: true,
      keyCount: 1,
    })
    expect(repaired.updatedAt).not.toBe(oldTimestamp)
  })

  test('rolls back a new connection and key when credential storage fails', async () => {
    const service = createProviderConnectionsService({ db, createAuthRuntime, credentialVault })
    const started = await service.initiateOAuth('failing-user', {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      label: 'OpenRouter',
      callbackUrl: 'http://localhost/oauth/callback',
    })

    expect(
      service.completeOAuth('failing-user', {
        state: started.state,
        code: 'oauth-code',
      }),
    ).rejects.toThrow('vault unavailable')
    expect((await service.listConnections('failing-user')).connections).toEqual([])
  })

  test('preserves an existing orphan when credential storage fails during repair', async () => {
    const orphanId = randomUUID()
    const timestamp = '2026-07-18T00:00:00.000Z'
    await db
      .insertInto('provider_connections')
      .values({
        id: orphanId,
        user_id: 'failing-existing-user',
        provider_id: 'openrouter',
        provider_name: 'OpenRouter',
        label: 'OpenRouter',
        auth_type: 'oauth-pkce',
        status: 'active',
        created_at: timestamp,
        updated_at: timestamp,
      })
      .execute()

    const service = createProviderConnectionsService({ db, createAuthRuntime, credentialVault })
    const started = await service.initiateOAuth('failing-existing-user', {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      label: 'OpenRouter',
      callbackUrl: 'http://localhost/oauth/callback',
    })
    expect(
      service.completeOAuth('failing-existing-user', {
        state: started.state,
        code: 'oauth-code',
      }),
    ).rejects.toThrow('vault unavailable')

    expect((await service.listConnections('failing-existing-user')).connections).toEqual([
      expect.objectContaining({ id: orphanId, keyCount: 0, updatedAt: timestamp }),
    ])
  })

  test('isolates an unreadable vault item and leaves the connection repairable', async () => {
    const stored = new Map<string, string>()
    let corruptAlias: string | null = null
    const resilientVault = {
      async set(userId: string, key: string, value: string) {
        stored.set(`${userId}:${key}`, value)
      },
      async resolve(userId: string, key: string) {
        if (key === corruptAlias) {
          throw Object.assign(new Error('Vault item cannot be decrypted'), { code: 'corrupt' })
        }
        return stored.get(`${userId}:${key}`) ?? null
      },
      async delete(userId: string, key: string) {
        return stored.delete(`${userId}:${key}`)
      },
    }
    const userId = 'corrupt-vault-user'
    const service = createProviderConnectionsService({
      db,
      credentialVault: resilientVault,
    })
    const connection = await service.createConnection(userId, {
      providerId: 'openrouter',
      providerName: 'OpenRouter',
      label: 'Damaged',
      authType: 'api-key',
      apiKey: 'sk-original',
    })
    const brokenKey = connection.keys[0]!

    corruptAlias = `provider.${brokenKey.id}`

    const listed = (await service.listConnections(userId)).connections[0]!
    expect(listed).toMatchObject({
      id: connection.id,
      hasApiKey: false,
      keyCount: 0,
      keys: [],
    })
    expect((await service.requireConnection(userId, connection.id)).keys).toEqual([])

    const repaired = await service.addKey(userId, connection.id, {
      apiKey: 'sk-replacement',
      label: 'replacement',
    })
    expect(repaired).toMatchObject({
      hasApiKey: true,
      keyCount: 1,
    })

    await service.deleteConnection(userId, connection.id)
    expect((await service.listConnections(userId)).connections).toEqual([])
  })
})

describe('every decrypted provider secret is registered for redaction', () => {
  /**
   * The registration that was missing. The vault exposure shield's two `remember` call sites cover
   * plugin config and the chat runtime's `resolveSecret`; provider credentials — the ones every
   * model request carries — were resolved straight from the vault and never registered, so a
   * provider error body echoing the key back was persisted and streamed unscrubbed. These pin the hook through the REAL public API (a stored connection + key), not the internal
   * helper.
   *
   * There are TWO hook points, not one. `readCredential` covers every read, but it
   * is not the whole story: `modify` reads (registering the old tokens), calls `update(current)`,
   * and returns the REFRESHED pair, which the engine then authenticates with — so the value actually in use
   * was unregistered until some later read. `writeCredential` closes that direction.
   */
  let db: ReturnType<typeof createDatabase>
  const dir = join(process.cwd(), 'tmp', 'provider-credential-shield-tests')

  beforeAll(async () => {
    await mkdir(dir, { recursive: true })
    db = createDatabase({ filename: join(dir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
  })

  afterAll(async () => {
    await destroyDatabase(db)
    await rm(dir, { recursive: true, force: true })
  })

  /** A service wired to a capturing shield hook, with one stored connection + key. */
  const setup = async () => {
    const remembered: string[] = []
    const store = new Map<string, string>()
    const service = createProviderConnectionsService({
      db,
      credentialVault: {
        async set(userId: string, key: string, value: string) {
          store.set(`${userId}:${key}`, value)
        },
        async resolve(userId: string, key: string) {
          return store.get(`${userId}:${key}`) ?? null
        },
        async delete(userId: string, key: string) {
          return store.delete(`${userId}:${key}`)
        },
      },
      onCredentialResolved: (_userId, value) => remembered.push(value),
    })
    const userId = `shield-${randomUUID()}`
    const connection = await service.createConnection(userId, {
      providerId: 'openai',
      providerName: 'OpenAI',
      label: 'OpenAI',
      authType: 'api-key',
      apiKey: 'placeholder-key',
    })
    const record = await service.requireConnection(userId, connection.id)
    const keyId = record.keys[0]!.id
    return { service, store, remembered, userId, connectionId: connection.id, keyId }
  }

  /** Store a credential through the service's own API, then read it back via the runtime store. */
  const readBack = async (credential: { type: 'api-key' | 'oauth'; [k: string]: unknown }) => {
    const ctx = await setup()
    // Overwrite the vault entry with the exact payload under test (`vaultKey` is `provider.<id>`),
    // so the assertion is about `readCredential` alone and not about how the DTO stored it.
    ctx.store.set(`${ctx.userId}:provider.${ctx.keyId}`, JSON.stringify(credential))
    ctx.remembered.length = 0
    const runtimeStore = await ctx.service.credentialStoreFor(
      ctx.userId,
      ctx.connectionId,
      ctx.keyId,
    )
    const resolved = await runtimeStore.read('openai')
    // A read happens twice on this path (the DTO hydration inside `requireConnectionRecord`, then
    // the runtime store's own read), and `remember` is idempotent — so assert on the SET.
    return { remembered: [...new Set(ctx.remembered)], resolved }
  }

  test('an API key is remembered when it is decrypted', async () => {
    const { remembered, resolved } = await readBack({ type: 'api-key', key: 'sk-live-secret-abc' })
    expect(remembered).toEqual(['sk-live-secret-abc'])
    expect(remembered).not.toContain('placeholder-key')
    expect(resolved).toMatchObject({ type: 'api-key', key: 'sk-live-secret-abc' })
  })

  test('BOTH halves of an OAuth credential are remembered', async () => {
    // An echoed refresh token is worse than an access token: it does not expire on its own.
    const { remembered } = await readBack({
      type: 'oauth',
      accessToken: 'at-secret-abcdefgh',
      refreshToken: 'rt-secret-abcdefgh',
      expiresAt: Number.MAX_SAFE_INTEGER,
    })
    expect([...remembered].sort()).toEqual(['at-secret-abcdefgh', 'rt-secret-abcdefgh'])
  })

  test('a malformed payload registers nothing and resolves to undefined', async () => {
    const missingKey = await readBack({ type: 'api-key' })
    expect(missingKey.remembered).toEqual([])
    expect(missingKey.resolved).toBeUndefined()

    const halfOauth = await readBack({ type: 'oauth', accessToken: 'only-half' })
    expect(halfOauth.remembered).toEqual([])
    expect(halfOauth.resolved).toBeUndefined()
  })

  test('the REFRESHED tokens a mid-run rotation returns are registered too', async () => {
    // The defect this pins: `modify` registered only what it READ. The rotated pair it hands
    // back is what the engine signs the next request with, and it was unknown to the shield until some later
    // read — which for a long run never comes.
    const ctx = await setup()
    ctx.store.set(
      `${ctx.userId}:provider.${ctx.keyId}`,
      JSON.stringify({
        type: 'oauth',
        accessToken: 'at-stale-abcdefgh',
        refreshToken: 'rt-stale-abcdefgh',
        expiresAt: 0,
      }),
    )
    const runtimeStore = await ctx.service.credentialStoreFor(
      ctx.userId,
      ctx.connectionId,
      ctx.keyId,
    )
    ctx.remembered.length = 0
    const rotated = {
      type: 'oauth' as const,
      accessToken: 'at-fresh-abcdefgh',
      refreshToken: 'rt-fresh-abcdefgh',
      expiresAt: Number.MAX_SAFE_INTEGER,
    }
    const returned = await runtimeStore.modify?.('openai', async () => rotated)

    expect(returned).toMatchObject({ accessToken: 'at-fresh-abcdefgh' })
    const seen = new Set(ctx.remembered)
    expect(seen.has('at-fresh-abcdefgh')).toBe(true)
    expect(seen.has('rt-fresh-abcdefgh')).toBe(true)
    // The stale pair is registered too (it was read on the way in) — harmless, and its being
    // there is not what this test is about.
    expect(seen.has('rt-stale-abcdefgh')).toBe(true)
  })
})
