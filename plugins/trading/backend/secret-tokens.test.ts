import { describe, expect, test } from 'bun:test'
import type { TradingConnectionConfig } from './contracts'
import { TradingError } from './errors'
import { credentialFields, resolveConfigSecrets, type ResolveSecret } from './secret-tokens'

function baseConfig(credentials: TradingConnectionConfig['credentials']): TradingConnectionConfig {
  return { exchangeId: 'binance', credentials }
}

describe('resolveConfigSecrets', () => {
  test('replaces a ${secret:KEY} token in EVERY credential field', async () => {
    const config = baseConfig({
      apiKey: '${secret:API_KEY}',
      secret: '${secret:API_SECRET}',
      password: '${secret:PASSPHRASE}',
      uid: '${secret:UID}',
      walletAddress: '${secret:WALLET}',
      privateKey: '${secret:PRIV_KEY}',
    })
    const values: Record<string, string> = {
      API_KEY: 'ak-real',
      API_SECRET: 'as-real',
      PASSPHRASE: 'pp-real',
      UID: 'uid-real',
      WALLET: '0xabc',
      PRIV_KEY: '0xdead',
    }
    const resolve: ResolveSecret = async (_userId, key) => values[key] ?? null

    const out = await resolveConfigSecrets('u1', config, resolve)
    expect(out.credentials).toEqual({
      apiKey: 'ak-real',
      secret: 'as-real',
      password: 'pp-real',
      uid: 'uid-real',
      walletAddress: '0xabc',
      privateKey: '0xdead',
    })
  })

  test('starts independent credential-field reads together', async () => {
    const config = baseConfig({
      apiKey: '${secret:API_KEY}',
      secret: '${secret:API_SECRET}',
      password: '${secret:PASSPHRASE}',
    })
    let started = 0
    let release = () => {}
    const mayFinish = new Promise<void>((resolve) => {
      release = resolve
    })
    const resultPromise = resolveConfigSecrets('u1', config, async (_userId, key) => {
      started += 1
      await mayFinish
      return key.toLowerCase()
    })

    await Promise.resolve()
    try {
      expect(started).toBe(3)
    } finally {
      release()
    }
    expect((await resultPromise).credentials).toEqual({
      apiKey: 'api_key',
      secret: 'api_secret',
      password: 'passphrase',
    })
  })

  test('leaves literal (non-token) credential values untouched', async () => {
    const config = baseConfig({ apiKey: 'plain-literal-key', secret: 'plain-literal-secret' })
    const resolve: ResolveSecret = async () => {
      throw new Error('must not be called — nothing here is a token')
    }
    const out = await resolveConfigSecrets('u1', config, resolve)
    expect(out.credentials).toEqual({ apiKey: 'plain-literal-key', secret: 'plain-literal-secret' })
  })

  test('returns the SAME object reference when nothing changed (no tokens, or no credentials)', async () => {
    const config = baseConfig({ apiKey: 'plain' })
    const resolve: ResolveSecret = async () => 'unused'
    const out = await resolveConfigSecrets('u1', config, resolve)
    expect(out).toBe(config)

    const noCreds: TradingConnectionConfig = { exchangeId: 'binance' }
    expect(await resolveConfigSecrets('u1', noCreds, resolve)).toBe(noCreds)
  })

  test('throws TradingError("auth_failed") when a token is present but no resolver is given', async () => {
    const config = baseConfig({ apiKey: '${secret:API_KEY}' })
    expect(resolveConfigSecrets('u1', config, undefined)).rejects.toThrow(TradingError)
    expect(resolveConfigSecrets('u1', config, undefined)).rejects.toMatchObject({
      code: 'auth_failed',
    })
  })

  test('throws TradingError("auth_failed") when the vault returns null for a referenced key', async () => {
    const config = baseConfig({ apiKey: '${secret:MISSING}' })
    const resolve: ResolveSecret = async () => null
    expect(resolveConfigSecrets('u1', config, resolve)).rejects.toMatchObject({
      code: 'auth_failed',
    })
  })

  test('passes the correct userId + key through to the resolver', async () => {
    const config = baseConfig({ apiKey: '${secret:K}' })
    const seen: { userId: string; key: string }[] = []
    const resolve: ResolveSecret = async (userId, key) => {
      seen.push({ userId, key })
      return 'v'
    }
    await resolveConfigSecrets('user-42', config, resolve)
    expect(seen).toEqual([{ userId: 'user-42', key: 'K' }])
  })
})

describe('credentialFields', () => {
  test('reports only populated fields, in declaration order', () => {
    expect(credentialFields(baseConfig({ apiKey: 'a', walletAddress: '0x1' }))).toEqual([
      'apiKey',
      'walletAddress',
    ])
  })

  test('an empty string does not count as populated', () => {
    expect(credentialFields(baseConfig({ apiKey: '' }))).toEqual([])
  })

  test('no credentials at all yields an empty list', () => {
    expect(credentialFields({ exchangeId: 'binance' })).toEqual([])
  })
})
