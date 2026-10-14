/**
 * Auth signing, covered with no host and no network. The invariants worth pinning are the ones a
 * refactor could quietly break: auth never mutates its input, it overwrites rather than
 * duplicates a header, and an apikey lands on the url the guard actually checked.
 */

import { describe, expect, test } from 'bun:test'
import { applyAuth, basicHeaderValue, finalHeaders } from './auth'
import { buildUrl, type Pair, type RequestSpec } from './request-spec'

const url = () => new URL('https://api.example.dev/v1/things')

describe('applyAuth', () => {
  test('none leaves the request untouched', () => {
    const headers: Pair[] = [{ name: 'Accept', value: 'application/json' }]
    const signed = applyAuth({ type: 'none' }, url(), headers)
    expect(signed.headers).toEqual(headers)
    expect(signed.url.toString()).toBe(url().toString())
  })

  test('basic writes an RFC 7617 Authorization header', () => {
    const signed = applyAuth({ type: 'basic', username: 'ada', password: 'hunter2' }, url(), [])
    expect(signed.headers).toEqual([
      { name: 'Authorization', value: basicHeaderValue('ada', 'hunter2') },
    ])
    expect(basicHeaderValue('ada', 'hunter2')).toBe(`Basic ${btoa('ada:hunter2')}`)
  })

  test('bearer defaults to the Bearer scheme and honours an override', () => {
    expect(applyAuth({ type: 'bearer', token: 'T' }, url(), []).headers[0].value).toBe('Bearer T')
    expect(
      applyAuth({ type: 'bearer', token: 'T', prefix: 'Token' }, url(), []).headers[0].value,
    ).toBe('Token T')
  })

  test('apikey defaults to a header', () => {
    const signed = applyAuth({ type: 'apikey', key: 'X-Api-Key', value: 'K' }, url(), [])
    expect(signed.headers).toEqual([{ name: 'X-Api-Key', value: 'K' }])
  })

  test('apikey in the query lands on the url', () => {
    const signed = applyAuth(
      { type: 'apikey', key: 'api_key', value: 'K', addTo: 'query' },
      url(),
      [],
    )
    expect(signed.url.searchParams.get('api_key')).toBe('K')
    expect(signed.headers).toEqual([])
  })

  test('apikey in a cookie appends to an existing Cookie rather than replacing it', () => {
    const signed = applyAuth({ type: 'apikey', key: 'sid', value: 'K', addTo: 'cookie' }, url(), [
      { name: 'Cookie', value: 'theme=dark' },
    ])
    expect(signed.headers).toEqual([{ name: 'Cookie', value: 'theme=dark; sid=K' }])
  })

  test('auth overwrites a same-named header instead of sending it twice', () => {
    const signed = applyAuth({ type: 'bearer', token: 'new' }, url(), [
      { name: 'authorization', value: 'Bearer old' },
    ])
    expect(signed.headers).toEqual([{ name: 'Authorization', value: 'Bearer new' }])
  })

  test('the caller’s headers are never mutated — a saved request re-signs from the same base', () => {
    const headers: Pair[] = [{ name: 'Accept', value: '*/*' }]
    applyAuth({ type: 'bearer', token: 'T' }, url(), headers)
    expect(headers).toEqual([{ name: 'Accept', value: '*/*' }])
  })
})

describe('finalHeaders', () => {
  const spec = (over: Partial<RequestSpec>): RequestSpec => ({
    url: 'https://api.example.dev/v1/things',
    method: 'GET',
    headers: [],
    query: [],
    auth: { type: 'none' },
    ...over,
  })

  test('drops disabled headers', () => {
    const s = spec({
      headers: [
        { name: 'Accept', value: 'application/json' },
        { name: 'X-Debug', value: '1', disabled: true },
      ],
    })
    const signed = finalHeaders(s, buildUrl(s))
    expect(signed.headers).toEqual([{ name: 'Accept', value: 'application/json' }])
  })
})
