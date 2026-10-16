/**
 * `secrets.ts` — the vault boundary, and until now untested.
 *
 * Its header makes two claims that nothing checked. Both are about what happens when things go
 * wrong, which is exactly the code nobody exercises by hand:
 *
 *   "Throws when a token is present but the vault is unreachable, rather than sending the token
 *    text as the credential: a request that fails loudly here is far cheaper than one that leaks
 *    `${secret:STRIPE_KEY}` into a third party's access log."
 *
 *   "Only auth fields are resolved. Headers and bodies are deliberately NOT scanned."
 */

import { describe, expect, test } from 'bun:test'
import {
  authNeedsVault,
  authSecret,
  resolveAuthSecrets,
  withAuthSecret,
  type ResolveSecret,
} from './secrets'
import type { RequestAuth } from './request-spec'

/** A vault holding exactly what it is given. */
const vault =
  (entries: Record<string, string>): ResolveSecret =>
  async (_userId, key) =>
    entries[key] ?? null

describe('authNeedsVault', () => {
  test.each([
    [{ type: 'bearer', token: '${secret:GH}' }, true],
    [{ type: 'basic', username: 'ada', password: '${secret:PW}' }, true],
    [{ type: 'apikey', key: 'X-K', value: '${secret:K}' }, true],
    [{ type: 'bearer', token: 'literal' }, false],
    [{ type: 'none' }, false],
  ] as const)('%j → %p', (auth, expected) => {
    expect(authNeedsVault(auth as RequestAuth)).toBe(expected)
  })

  test('a reference in a NON-secret field does not count — only the secret field is read', () => {
    // A username is not a credential; the vault is for the password beside it.
    expect(authNeedsVault({ type: 'basic', username: '${secret:USER}', password: 'p' })).toBe(false)
  })
})

describe('resolving', () => {
  test('a bearer token is replaced with the vault value', async () => {
    const out = await resolveAuthSecrets(
      'u',
      { type: 'bearer', token: '${secret:GH}' },
      vault({ GH: 'ghp_real' }),
    )
    expect(out).toEqual({ type: 'bearer', token: 'ghp_real' })
  })

  test('a basic password resolves; the username is left alone', async () => {
    const out = await resolveAuthSecrets(
      'u',
      { type: 'basic', username: 'ada', password: '${secret:PW}' },
      vault({ PW: 'hunter2' }),
    )
    expect(out).toEqual({ type: 'basic', username: 'ada', password: 'hunter2' })
  })

  test('an apikey value resolves; its header name is left alone', async () => {
    const out = await resolveAuthSecrets(
      'u',
      { type: 'apikey', key: 'X-Api-Key', value: '${secret:K}', addTo: 'header' },
      vault({ K: 'sk_live' }),
    )
    expect(out).toEqual({ type: 'apikey', key: 'X-Api-Key', value: 'sk_live', addTo: 'header' })
  })

  test('a reference EMBEDDED in a larger string resolves in place', async () => {
    const out = await resolveAuthSecrets(
      'u',
      { type: 'bearer', token: 'v1-${secret:GH}-suffix' },
      vault({ GH: 'X' }),
    )
    expect((out as { token: string }).token).toBe('v1-X-suffix')
  })

  test('auth with no reference is returned UNCHANGED, without touching the vault', async () => {
    const auth: RequestAuth = { type: 'bearer', token: 'literal' }
    let called = false
    const out = await resolveAuthSecrets('u', auth, async () => {
      called = true
      return 'nope'
    })
    expect(out).toBe(auth)
    expect(called).toBe(false)
  })

  test('auth=none never reaches the vault', async () => {
    const out = await resolveAuthSecrets('u', { type: 'none' }, async () => {
      throw new Error('must not be called')
    })
    expect(out).toEqual({ type: 'none' })
  })

  test('the input auth is not mutated — a saved request re-resolves next send', async () => {
    const auth: RequestAuth = { type: 'bearer', token: '${secret:GH}' }
    await resolveAuthSecrets('u', auth, vault({ GH: 'ghp_real' }))
    expect(auth.token).toBe('${secret:GH}')
  })

  test('the userId is passed through — the vault is per-user', async () => {
    const seen: string[] = []
    await resolveAuthSecrets('alice', { type: 'bearer', token: '${secret:GH}' }, async (u, k) => {
      seen.push(`${u}/${k}`)
      return 'x'
    })
    expect(seen).toEqual(['alice/GH'])
  })
})

describe('an unresolvable reference FAILS LOUDLY — it is never sent as text', () => {
  // The claim this file exists for. Sending `${secret:STRIPE_KEY}` as the credential would put
  // the literal token text into a third party's access log, and return a 401 that reads like an
  // API problem rather than a setup step.
  test('a MISSING key throws, naming the key', async () => {
    const err = await resolveAuthSecrets('u', { type: 'bearer', token: '${secret:GH}' }, vault({}))
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
    expect(err).toContain('GH')
  })

  test('no vault at all throws, and says what to do', async () => {
    const err = await resolveAuthSecrets('u', { type: 'bearer', token: '${secret:GH}' }, undefined)
      .then(() => null)
      .catch((e: unknown) => (e instanceof Error ? e.message : String(e)))
    expect(err).toContain('secrets store is unavailable')
  })

  test('the token TEXT is never returned as the credential', async () => {
    // The failure mode being prevented: a resolve that quietly yields the reference itself.
    const out = await resolveAuthSecrets('u', { type: 'bearer', token: '${secret:GH}' }, vault({}))
      .then((a) => JSON.stringify(a))
      .catch(() => '(threw)')
    expect(out).toBe('(threw)')
  })

  test('a vault with no writer but auth that needs NOTHING still works', async () => {
    // Absence of a vault must not break a request that never wanted one.
    expect(await resolveAuthSecrets('u', { type: 'bearer', token: 'literal' }, undefined)).toEqual({
      type: 'bearer',
      token: 'literal',
    })
  })
})

describe('only AUTH is resolved — headers and bodies are deliberately not scanned', () => {
  // The other claim. A `${secret:}` in a header would be a credential the user typed into a
  // plaintext field, and making it work silently would encourage exactly that.
  test('resolveAuthSecrets takes auth alone — a header cannot reach it', async () => {
    // The signature IS the guarantee: there is no path from a header into this function.
    const auth = await resolveAuthSecrets('u', { type: 'none' }, vault({ GH: 'ghp_real' }))
    expect(auth).toEqual({ type: 'none' })
  })
})

describe('authSecret / withAuthSecret — one table for every variant', () => {
  test('each variant names its one secret field, and a write keeps the rest of the variant', () => {
    const variants: RequestAuth[] = [
      { type: 'none' },
      { type: 'basic', username: 'u', password: 'p' },
      { type: 'bearer', token: 't', prefix: 'Token' },
      { type: 'apikey', key: 'X-Key', value: 'v', addTo: 'query' },
    ]
    expect(variants.map((auth) => authSecret(auth)?.field ?? null)).toEqual([
      null,
      'password',
      'token',
      'value',
    ])
    expect(variants.map((auth) => withAuthSecret(auth, 'S'))).toEqual([
      { type: 'none' },
      { type: 'basic', username: 'u', password: 'S' },
      { type: 'bearer', token: 'S', prefix: 'Token' },
      { type: 'apikey', key: 'X-Key', value: 'S', addTo: 'query' },
    ])
  })
})
