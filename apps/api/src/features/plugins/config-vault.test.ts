import { afterEach, describe, expect, test } from 'bun:test'

import {
  forgetSecretOptions,
  hydrateSecretOptions,
  observePluginConfigVault,
  pluginOptionKey,
  sealSecretOptions,
  type PluginConfigVault,
} from './config-vault'

/** An in-memory vault that counts reads, as the real one audits each. */
function fakeVault() {
  const items = new Map<string, { value: string; version: number }>()
  let reads = 0
  const vault: PluginConfigVault = {
    async store(userId, key, value) {
      const held = items.get(`${userId}:${key}`)
      items.set(`${userId}:${key}`, { value, version: (held?.version ?? 0) + 1 })
    },
    async resolve(userId, key) {
      reads += 1
      return items.get(`${userId}:${key}`)?.value ?? null
    },
    async versions(userId, prefix) {
      return new Map(
        [...items]
          .filter(([id]) => id.startsWith(`${userId}:${prefix}`))
          .map(([id, item]) => [id.slice(userId.length + 1), item.version]),
      )
    },
    async remove(userId, key) {
      items.delete(`${userId}:${key}`)
    },
  }
  return { vault, items, reads: () => reads }
}

const declared = { api_url: {}, api_token: { secret: true } }

afterEach(() => observePluginConfigVault(undefined))

describe('plugin config vault', () => {
  test('a sensitive option goes to the vault and the row keeps only a handle', async () => {
    const { vault, items } = fakeVault()
    observePluginConfigVault(vault)
    const patch = await sealSecretOptions({
      userId: 'u1',
      pluginName: 'lc',
      scope: '',
      declared,
      patch: { api_url: 'https://x', api_token: 'CANARY' },
    })
    const key = pluginOptionKey('lc', '', 'api_token')
    expect(patch).toEqual({ api_url: 'https://x', api_token: `secret:${key}` })
    expect(JSON.stringify(patch)).not.toContain('CANARY')
    expect(items.get(`u1:${key}`)?.value).toBe('CANARY')

    const [row] = await hydrateSecretOptions('u1', [{ name: 'lc', projectId: '', config: patch }])
    expect(row!.config).toEqual({ api_url: 'https://x', api_token: 'CANARY' })
  })

  test('a plain-text secret an older build stored is moved on the next save', async () => {
    const { vault } = fakeVault()
    observePluginConfigVault(vault)
    const patch = await sealSecretOptions({
      userId: 'u1',
      pluginName: 'lc',
      scope: 'p1',
      declared,
      patch: { api_url: 'https://y' },
      existing: { api_token: 'OLD-PLAIN' },
    })
    expect(patch.api_token).toBe(`secret:${pluginOptionKey('lc', 'p1', 'api_token')}`)
  })

  test('an unchanged item is read once; a rotated or deleted one is noticed', async () => {
    const { vault, items, reads } = fakeVault()
    observePluginConfigVault(vault)
    const config = await sealSecretOptions({
      userId: 'u1',
      pluginName: 'lc',
      scope: '',
      declared,
      patch: { api_token: 'ONE' },
    })
    const read = async () =>
      (await hydrateSecretOptions('u1', [{ name: 'lc', projectId: '', config }]))[0]!.config
        .api_token
    expect(await read()).toBe('ONE')
    expect(await read()).toBe('ONE')
    expect(reads()).toBe(1)

    const key = pluginOptionKey('lc', '', 'api_token')
    await vault.store('u1', key, 'TWO', 'lc')
    expect(await read()).toBe('TWO')
    items.delete(`u1:${key}`)
    expect(await read()).toBeUndefined()
  })

  test('forgetting a plugin deletes its items in every scope and no other plugin’s', async () => {
    const { vault, items } = fakeVault()
    observePluginConfigVault(vault)
    for (const [name, scope] of [
      ['lc', ''],
      ['lc', 'p1'],
      ['lc-other', ''],
    ] as const)
      await sealSecretOptions({
        userId: 'u1',
        pluginName: name,
        scope,
        declared,
        patch: { api_token: 'X' },
      })
    await forgetSecretOptions('u1', 'lc')
    expect([...items.keys()]).toEqual([`u1:${pluginOptionKey('lc-other', '', 'api_token')}`])
  })

  test('a handle naming another plugin’s or option’s item is neither saved nor read', async () => {
    const { vault } = fakeVault()
    observePluginConfigVault(vault)
    await sealSecretOptions({
      userId: 'u1',
      pluginName: 'a',
      scope: '',
      declared,
      patch: { api_token: 'CANARY-A' },
    })
    const foreign = `secret:${pluginOptionKey('a', '', 'api_token')}`
    const sealed = await sealSecretOptions({
      userId: 'u1',
      pluginName: 'b',
      scope: '',
      declared,
      patch: { api_url: foreign, api_token: foreign },
    })
    expect(sealed).toEqual({})
    // A row written some other way still does not resolve it, for a sibling option either.
    const rows = await hydrateSecretOptions<{
      name: string
      projectId: string
      config: Record<string, unknown>
    }>('u1', [
      { name: 'b', projectId: '', config: { api_url: foreign } },
      { name: 'a', projectId: '', config: { api_url: foreign } },
      { name: 'a', projectId: 'p1', config: { api_token: foreign } },
    ])
    expect(rows.map((row) => row.config)).toEqual([{}, {}, {}])
  })

  test('an item the vault cannot read is unset, reported once and not read again', async () => {
    const { vault } = fakeVault()
    observePluginConfigVault(vault)
    const config = await sealSecretOptions({
      userId: 'u1',
      pluginName: 'lc',
      scope: '',
      declared,
      patch: { api_url: 'https://x', api_token: 'X' },
    })
    let reads = 0
    const warnings: unknown[] = []
    observePluginConfigVault(
      {
        ...vault,
        resolve: async () => {
          reads += 1
          throw new Error('Vault item cannot be decrypted')
        },
      },
      (entry) => warnings.push(entry),
    )
    for (let i = 0; i < 2; i++) {
      const [row] = await hydrateSecretOptions('u1', [{ name: 'lc', projectId: '', config }])
      expect(row!.config).toEqual({ api_url: 'https://x' })
    }
    expect(reads).toBe(1)
    expect(warnings).toHaveLength(1)
  })

  test('keys are one per plugin, scope and option, and stay within the vault’s length', () => {
    const keys = [
      pluginOptionKey('a.b', '', 'tok'),
      pluginOptionKey('a-b', '', 'tok'),
      pluginOptionKey('a', '', 'b.tok'),
      pluginOptionKey('a', '', 'b-tok'),
      pluginOptionKey('_x61', '', 'tok'),
      pluginOptionKey('a', '', 'x'.repeat(200)),
      pluginOptionKey('a', '', `${'x'.repeat(199)}y`),
    ]
    expect(new Set(keys).size).toBe(keys.length)
    for (const key of keys) expect(key).toMatch(/^[A-Za-z0-9_.-]{1,128}$/)
    expect(pluginOptionKey('lc', '', 'api_token')).toBe('plugin-option.lc.user.api_token')
  })

  test('without a vault, options are stored as they are', async () => {
    const patch = { api_token: 'PLAIN' }
    expect(
      await sealSecretOptions({ userId: 'u1', pluginName: 'lc', scope: '', declared, patch }),
    ).toEqual(patch)
  })
})
