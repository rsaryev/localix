import { describe, expect, test } from 'bun:test'
import { fauxProvider, type Credential, type OAuthAuth, type Provider } from '@earendil-works/pi-ai'

import type {
  RuntimeAuthEvent,
  RuntimeCredential,
  RuntimeCredentialInfo,
  RuntimeCredentialStore,
} from '@localixai/agent/runtime'

import {
  createPiAuthRuntime,
  fromPiCredential,
  PiCredentialStoreAdapter,
  toPiCredential,
} from './auth'
import { createPiCredentialStore } from './models'
import { createPiEngine } from './engine'

class MemoryCredentialStore implements RuntimeCredentialStore {
  readonly values = new Map<string, RuntimeCredential>()
  readonly writes: string[] = []

  async read(providerId: string): Promise<RuntimeCredential | undefined> {
    return this.values.get(providerId)
  }

  async list(): Promise<readonly RuntimeCredentialInfo[]> {
    return [...this.values].map(([providerId, credential]) => ({
      providerId,
      type: credential.type,
    }))
  }

  async modify(
    providerId: string,
    update: (current: RuntimeCredential | undefined) => Promise<RuntimeCredential | undefined>,
  ): Promise<RuntimeCredential | undefined> {
    const next = await update(this.values.get(providerId))
    if (next !== undefined) {
      this.values.set(providerId, next)
      this.writes.push(providerId)
    }
    return this.values.get(providerId)
  }

  async delete(providerId: string): Promise<void> {
    this.values.delete(providerId)
  }
}

function authProvider(): Provider {
  const base = fauxProvider({ provider: 'auth-test' }).provider
  const oauth: OAuthAuth = {
    name: 'Test subscription',
    loginLabel: 'Sign in to Test',
    async login(interaction) {
      interaction.notify({
        type: 'auth_url',
        url: 'https://auth.example.test',
        instructions: 'Continue in browser',
      })
      interaction.notify({ type: 'progress', message: 'Waiting for approval' })
      const code = await interaction.prompt({
        type: 'manual_code',
        message: 'Paste the code',
        placeholder: 'code',
      })
      return {
        type: 'oauth',
        access: `access:${code}`,
        refresh: 'refresh-token',
        expires: 1234,
        accountId: 'account-1',
      }
    },
    async refresh(credential) {
      return { ...credential, access: 'refreshed', expires: 5678 }
    },
    async toAuth(credential) {
      return { apiKey: credential.access }
    },
  }
  return {
    ...base,
    name: 'Auth Test',
    auth: {
      apiKey: {
        name: 'Test API key',
        async login(interaction) {
          const key = await interaction.prompt({
            type: 'secret',
            message: 'Enter the key',
          })
          return { type: 'api_key', key }
        },
        async resolve({ credential }) {
          return credential?.key
            ? { auth: { apiKey: credential.key }, source: 'stored' }
            : undefined
        },
      },
      oauth,
    },
  }
}

describe('pi credential conversion', () => {
  test('round-trips provider-specific OAuth fields without allowing canonical overrides', () => {
    const runtime: RuntimeCredential = {
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 42,
      extra: {
        accountId: 'acct',
        access: 'must-not-override',
        type: 'must-not-override',
      },
    }

    const pi = toPiCredential(runtime)
    expect(pi).toEqual({
      type: 'oauth',
      access: 'access',
      refresh: 'refresh',
      expires: 42,
      accountId: 'acct',
    })
    expect(fromPiCredential(pi)).toEqual({
      type: 'oauth',
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 42,
      extra: { accountId: 'acct' },
    })
  })

  test('delegates pi refresh writes through the host store modify callback', async () => {
    const host = new MemoryCredentialStore()
    host.values.set('provider', {
      type: 'oauth',
      accessToken: 'old',
      refreshToken: 'refresh',
      expiresAt: 0,
    })
    const adapter = new PiCredentialStoreAdapter(host)

    const result = await adapter.modify('provider', async (current) => {
      expect(current?.type).toBe('oauth')
      return {
        ...(current as Extract<Credential, { type: 'oauth' }>),
        access: 'new',
        expires: 100,
      }
    })

    expect(result).toMatchObject({ type: 'oauth', access: 'new', expires: 100 })
    expect(await host.read('provider')).toMatchObject({
      type: 'oauth',
      accessToken: 'new',
      expiresAt: 100,
    })
    expect(host.writes).toEqual(['provider'])
  })

  test('uses the run snapshot as the first durable refresh value', async () => {
    const host = new MemoryCredentialStore()
    const adapter = createPiCredentialStore(
      { providerId: 'provider', modelId: 'model' },
      {
        type: 'oauth',
        accessToken: 'snapshot-access',
        refreshToken: 'snapshot-refresh',
        expiresAt: 0,
      },
      host,
    )

    const result = await adapter.modify('provider', async (current) => {
      expect(current).toMatchObject({
        type: 'oauth',
        access: 'snapshot-access',
        refresh: 'snapshot-refresh',
      })
      return current?.type === 'oauth'
        ? { ...current, access: 'rotated-access', refresh: 'rotated-refresh' }
        : undefined
    })

    expect(result).toMatchObject({
      type: 'oauth',
      access: 'rotated-access',
      refresh: 'rotated-refresh',
    })
    expect(await host.read('provider')).toMatchObject({
      type: 'oauth',
      accessToken: 'rotated-access',
      refreshToken: 'rotated-refresh',
    })
  })
})

describe('pi auth runtime', () => {
  test('passes the host installation UUID through the engine to subscription login', async () => {
    const store = new MemoryCredentialStore()
    const deviceId = 'b5bd2b99-1c3b-40e7-95e9-a417dfde2b18'
    const controller = new AbortController()
    let authUrl: string | undefined
    const engine = createPiEngine({ getDeviceId: () => deviceId })
    const deadline = setTimeout(() => controller.abort(), 5_000)
    try {
      await expect(
        engine.createAuth(store).login('openai', 'oauth', {
          signal: controller.signal,
          prompt: async () => new Promise<string>(() => {}),
          notify(event) {
            if (event.type === 'auth-url') {
              authUrl = event.url
              controller.abort()
            }
          },
        }),
      ).rejects.toThrow()
      expect(authUrl).toBeDefined()
      const url = new URL(authUrl!)
      expect(url.origin).toBe('https://auth.openai.com')
      expect(url.searchParams.get('ext_agent_host_id')).toBe(`urn:uuid:${deviceId}`)
      expect(await store.read('openai')).toBeUndefined()
    } finally {
      clearTimeout(deadline)
      controller.abort()
    }
  })

  test('maps provider metadata, interaction events and OAuth credentials', async () => {
    const store = new MemoryCredentialStore()
    const auth = createPiAuthRuntime({ credentialStore: store, providers: [authProvider()] })
    const events: RuntimeAuthEvent[] = []

    expect(auth.listProviders()).toEqual([
      {
        id: 'auth-test',
        name: 'Auth Test',
        methods: [
          { type: 'api-key', name: 'Test API key' },
          {
            type: 'oauth',
            name: 'Test subscription',
            loginLabel: 'Sign in to Test',
          },
        ],
      },
    ])

    const credential = await auth.login('auth-test', 'oauth', {
      async prompt(prompt) {
        expect(prompt).toMatchObject({
          type: 'manual-code',
          message: 'Paste the code',
          placeholder: 'code',
        })
        return 'confirmed'
      },
      async notify(event) {
        await new Promise((resolve) => setTimeout(resolve, event.type === 'auth-url' ? 2 : 0))
        events.push(event)
      },
    })

    expect(events).toEqual([
      {
        type: 'auth-url',
        url: 'https://auth.example.test',
        instructions: 'Continue in browser',
      },
      { type: 'progress', message: 'Waiting for approval' },
    ])
    expect(credential).toEqual({
      type: 'oauth',
      accessToken: 'access:confirmed',
      refreshToken: 'refresh-token',
      expiresAt: 1234,
      extra: { accountId: 'account-1' },
    })
    expect(await store.read('auth-test')).toEqual(credential)

    await auth.logout('auth-test')
    expect(await store.read('auth-test')).toBeUndefined()
  })

  test('maps api-key login without a provider-specific OAuth flow', async () => {
    const store = new MemoryCredentialStore()
    const auth = createPiAuthRuntime({ credentialStore: store, providers: [authProvider()] })

    const credential = await auth.login('auth-test', 'api-key', {
      async prompt(prompt) {
        expect(prompt).toMatchObject({ type: 'secret', message: 'Enter the key' })
        return 'sk-test'
      },
      notify() {},
    })

    expect(credential).toEqual({ type: 'api-key', key: 'sk-test', env: undefined })
    expect(await store.read('auth-test')).toEqual(credential)
  })
})
