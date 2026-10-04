/**
 * The ONE redaction module (KEY-5). The claims that matter: the plugin's own credential
 * field names are covered even where no generic marker would catch them, the walk is deep
 * and cycle-safe, and free text loses its `${secret:KEY}` tokens.
 */
import { describe, expect, test } from 'bun:test'
import { CREDENTIAL_FIELDS } from './contracts'
import { REDACTED, isSensitiveKey, redactValue, stripSecretRefs } from './redact'

describe('isSensitiveKey', () => {
  test('every persisted credential field is sensitive, whatever its casing', () => {
    for (const field of CREDENTIAL_FIELDS) {
      expect(isSensitiveKey(field)).toBe(true)
      expect(isSensitiveKey(field.toUpperCase())).toBe(true)
    }
  })

  test('generic markers catch foreign spellings; ordinary order fields pass', () => {
    for (const k of ['api_key', 'accessToken', 'Authorization', 'subAccountSecret', 'passphrase'])
      expect(isSensitiveKey(k)).toBe(true)
    for (const k of ['symbol', 'side', 'amount', 'price', 'clientOrderId', 'reduceOnly'])
      expect(isSensitiveKey(k)).toBe(false)
  })
})

describe('redactValue', () => {
  test('deep: a sensitive key is redacted at any depth, in arrays too; the rest survives intact', () => {
    const input = {
      symbol: 'BTC/USDT',
      params: { apiKey: 'raw', nested: [{ token: 'x', keep: 1 }] },
      legs: [{ price: 5 }],
    }
    expect(redactValue(input)).toEqual({
      symbol: 'BTC/USDT',
      params: { apiKey: REDACTED, nested: [{ token: REDACTED, keep: 1 }] },
      legs: [{ price: 5 }],
    })
    // The ORIGINAL is untouched — redaction is a copy, never a mutation of live state.
    expect(input.params.apiKey).toBe('raw')
  })

  test('free strings lose their ${secret:} tokens; a cycle is cut, not recursed', () => {
    expect(redactValue('use ${secret:MY_KEY} here')).toBe('use [secret-ref] here')
    const cyclic: Record<string, unknown> = { a: 1 }
    cyclic.self = cyclic
    expect(redactValue(cyclic)).toEqual({ a: 1, self: REDACTED })
  })

  test('null/absent sensitive values stay as they are — absence is not a secret', () => {
    expect(redactValue({ apiKey: undefined, secret: null })).toEqual({
      apiKey: undefined,
      secret: null,
    })
  })
})

describe('stripSecretRefs', () => {
  test('strips every token, leaves surrounding text, and is safe to call repeatedly', () => {
    const s = 'a ${secret:ONE} b ${secret:TWO_2.x-y} c'
    expect(stripSecretRefs(s)).toBe('a [secret-ref] b [secret-ref] c')
    expect(stripSecretRefs(stripSecretRefs(s))).toBe('a [secret-ref] b [secret-ref] c')
    expect(stripSecretRefs('no tokens')).toBe('no tokens')
  })
})
