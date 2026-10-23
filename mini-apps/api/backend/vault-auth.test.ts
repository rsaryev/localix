/**
 * Moving a literal into the vault. The claim under test is the one the feature exists for: after
 * an import, the literal is in the vault and the saved auth holds only a reference.
 */

import { describe, expect, test } from 'bun:test'
import { vaultKeyFor, vaultLiteralAuth, type StoreSecret } from './vault-auth'
import type { RequestAuth } from './request-spec'

/** A vault stub. `taken` seeds keys that already exist, so collisions are testable. */
function stubVault(taken: string[] = []) {
  const written = new Map<string, string>()
  const exists = new Set(taken)
  const storeSecret: StoreSecret = async (_userId, key, value) => {
    if (exists.has(key)) return false
    exists.add(key)
    written.set(key, value)
    return true
  }
  return { storeSecret, written }
}

describe('vaultKeyFor', () => {
  test.each([
    ['github-user', 'token', 'REST_GITHUB_USER_TOKEN'],
    ['api-v1-things', 'value', 'REST_API_V1_THINGS_VALUE'],
    ['weird/name here', 'password', 'REST_WEIRD_NAME_HERE_PASSWORD'],
  ])('%p + %p → %p', (name, field, expected) => {
    expect(vaultKeyFor(name, field)).toBe(expected)
  })

  test('a name with nothing usable still yields a legal key', () => {
    expect(vaultKeyFor('///', 'token')).toBe('REST_REQUEST_TOKEN')
  })

  test('the key is namespaced — the vault is shared with every other integration', () => {
    expect(vaultKeyFor('github', 'token')).toStartWith('REST_')
  })
})

describe('vaultLiteralAuth', () => {
  test('a literal bearer token moves into the vault and leaves a reference', async () => {
    const { storeSecret, written } = stubVault()
    const auth: RequestAuth = { type: 'bearer', token: 'ghp_SUPERSECRET' }
    const out = await vaultLiteralAuth('u', 'github-user', auth, storeSecret)

    expect(out.key).toBe('REST_GITHUB_USER_TOKEN')
    expect(out.auth).toEqual({ type: 'bearer', token: '${secret:REST_GITHUB_USER_TOKEN}' })
    // The literal is in the vault…
    expect(written.get('REST_GITHUB_USER_TOKEN')).toBe('ghp_SUPERSECRET')
    // …and nowhere in what we are about to persist.
    expect(JSON.stringify(out.auth)).not.toContain('ghp_SUPERSECRET')
  })

  test('a basic password moves; the username stays — it is not a secret', async () => {
    const { storeSecret, written } = stubVault()
    const auth: RequestAuth = { type: 'basic', username: 'ada', password: 'hunter2' }
    const out = await vaultLiteralAuth('u', 'gh', auth, storeSecret)
    expect(out.auth).toEqual({
      type: 'basic',
      username: 'ada',
      password: '${secret:REST_GH_PASSWORD}',
    })
    expect(written.get('REST_GH_PASSWORD')).toBe('hunter2')
  })

  test('an apikey value moves; its header name stays', async () => {
    const { storeSecret } = stubVault()
    const auth: RequestAuth = { type: 'apikey', key: 'X-Api-Key', value: 'sk_live_abc' }
    const out = await vaultLiteralAuth('u', 'stripe', auth, storeSecret)
    expect(out.auth).toEqual({
      type: 'apikey',
      key: 'X-Api-Key',
      value: '${secret:REST_STRIPE_VALUE}',
    })
  })

  test('auth=none has nothing to move', async () => {
    const { storeSecret, written } = stubVault()
    const out = await vaultLiteralAuth('u', 'gh', { type: 'none' }, storeSecret)
    expect(out).toEqual({ auth: { type: 'none' }, key: null })
    expect(written.size).toBe(0)
  })

  test('a value that is ALREADY a reference is left alone — nothing to move', async () => {
    const { storeSecret, written } = stubVault()
    const auth: RequestAuth = { type: 'bearer', token: '${secret:EXISTING}' }
    const out = await vaultLiteralAuth('u', 'gh', auth, storeSecret)
    expect(out.auth).toBe(auth)
    expect(out.key).toBeNull()
    expect(written.size).toBe(0)
  })

  test('an empty credential is not vaulted', async () => {
    const { storeSecret, written } = stubVault()
    const out = await vaultLiteralAuth('u', 'gh', { type: 'bearer', token: '' }, storeSecret)
    expect(out.key).toBeNull()
    expect(written.size).toBe(0)
  })
})

describe('collisions suffix rather than overwrite', () => {
  test('a taken key is stepped past, and the existing secret is untouched', async () => {
    const { storeSecret, written } = stubVault(['REST_GH_TOKEN'])
    const out = await vaultLiteralAuth('u', 'gh', { type: 'bearer', token: 'second' }, storeSecret)
    expect(out.key).toBe('REST_GH_TOKEN_2')
    expect(written.get('REST_GH_TOKEN_2')).toBe('second')
    // The point: two requests against one API carry two DIFFERENT tokens. Pointing the second at
    // the first's secret would send the wrong credential with nothing to show it happened.
    expect(written.has('REST_GH_TOKEN')).toBe(false)
  })

  test('several collisions keep stepping', async () => {
    const { storeSecret } = stubVault(['REST_GH_TOKEN', 'REST_GH_TOKEN_2', 'REST_GH_TOKEN_3'])
    const out = await vaultLiteralAuth('u', 'gh', { type: 'bearer', token: 'x' }, storeSecret)
    expect(out.key).toBe('REST_GH_TOKEN_4')
  })

  test('a vault that refuses every name leaves the literal in place rather than throwing', async () => {
    const always: StoreSecret = async () => false
    const auth: RequestAuth = { type: 'bearer', token: 'literal' }
    const out = await vaultLiteralAuth('u', 'gh', auth, always)
    // The request still works and still saves; the caller reports the miss via `key: null`.
    expect(out.auth).toBe(auth)
    expect(out.key).toBeNull()
  })
})

describe('no vault writer bound', () => {
  test('the literal is kept and reported, not dropped', async () => {
    const auth: RequestAuth = { type: 'bearer', token: 'literal' }
    const out = await vaultLiteralAuth('u', 'gh', auth, undefined)
    expect(out.auth).toBe(auth)
    expect(out.key).toBeNull()
  })
})
