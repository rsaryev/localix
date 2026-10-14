/**
 * The keep-the-masked-secret merge: the one rule that lets a browser save an auth block it only
 * ever saw redacted, without clobbering the stored secret it could not read.
 */

import { describe, expect, test } from 'bun:test'
import { mergeAuth } from './auth-edit'
import { REDACTED } from './store'
import type { RequestAuth } from './request-spec'

describe('mergeAuth', () => {
  test('a masked secret keeps the stored value', () => {
    const stored: RequestAuth = { type: 'bearer', token: 'sk-real-token' }
    const incoming: RequestAuth = { type: 'bearer', token: REDACTED }
    expect(mergeAuth(stored, incoming)).toEqual({ type: 'bearer', token: 'sk-real-token' })
  })

  test('a changed secret overwrites', () => {
    const stored: RequestAuth = { type: 'bearer', token: 'old' }
    const incoming: RequestAuth = { type: 'bearer', token: 'new' }
    expect(mergeAuth(stored, incoming)).toEqual({ type: 'bearer', token: 'new' })
  })

  test('a ${secret:KEY} reference round-trips as itself (it is never masked)', () => {
    const stored: RequestAuth = { type: 'bearer', token: 'literal' }
    const incoming: RequestAuth = { type: 'bearer', token: '${secret:GH}' }
    expect(mergeAuth(stored, incoming)).toEqual({ type: 'bearer', token: '${secret:GH}' })
  })

  test('changing the auth TYPE cannot keep a stale secret (no field to keep from)', () => {
    const stored: RequestAuth = { type: 'bearer', token: 'sk-real' }
    // Switching to basic: the masked password has no bearer counterpart, so it stays as typed.
    const incoming: RequestAuth = { type: 'basic', username: 'u', password: REDACTED }
    expect(mergeAuth(stored, incoming)).toEqual({
      type: 'basic',
      username: 'u',
      password: REDACTED,
    })
  })

  test('basic keeps its password, not its username', () => {
    const stored: RequestAuth = { type: 'basic', username: 'old-user', password: 'sk' }
    const incoming: RequestAuth = { type: 'basic', username: 'new-user', password: REDACTED }
    expect(mergeAuth(stored, incoming)).toEqual({
      type: 'basic',
      username: 'new-user',
      password: 'sk',
    })
  })

  test('apikey keeps its value, keeps addTo/key as sent', () => {
    const stored: RequestAuth = {
      type: 'apikey',
      key: 'X-Api-Key',
      value: 'secret',
      addTo: 'header',
    }
    const incoming: RequestAuth = {
      type: 'apikey',
      key: 'X-Api-Key',
      value: REDACTED,
      addTo: 'query',
    }
    expect(mergeAuth(stored, incoming)).toEqual({
      type: 'apikey',
      key: 'X-Api-Key',
      value: 'secret',
      addTo: 'query',
    })
  })

  test('switching to none drops everything', () => {
    const stored: RequestAuth = { type: 'bearer', token: 'sk' }
    expect(mergeAuth(stored, { type: 'none' })).toEqual({ type: 'none' })
  })
})
