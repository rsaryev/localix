/**
 * The HAR importer. A HAR is a machine recording, so the cases that matter are the ones a real
 * browser export contains: the doubled cookie view, query strings already split out, and entries
 * that aren't requests at all.
 */

import { describe, expect, test } from 'bun:test'
import { convertHar } from './har'

const har = (entries: unknown[]) => JSON.stringify({ log: { entries } })
const entry = (request: unknown, comment?: string) => ({ request, ...(comment ? { comment } : {}) })

describe('format sniffing', () => {
  test.each(['curl https://api.dev', 'not json at all', ''])('%p is not a HAR', (text) => {
    expect(convertHar(text)).toBeNull()
  })

  test('JSON that is not a HAR is declined, leaving the chain to try others', () => {
    expect(convertHar('{"info":{"name":"a postman collection"}}')).toBeNull()
  })

  test('a HAR with no entries is claimed but empty', () => {
    expect(convertHar(har([]))).toEqual([])
  })
})

describe('requests', () => {
  test('method and url import', () => {
    const out = convertHar(har([entry({ method: 'post', url: 'https://api.dev/things' })]))!
    expect(out).toHaveLength(1)
    expect(out[0].spec.method).toBe('POST') // lowercased in the archive, canonical here
    expect(out[0].spec.url).toBe('https://api.dev/things')
  })

  test('the query string is dropped from the url — HAR lists it separately', () => {
    const out = convertHar(
      har([
        entry({
          method: 'GET',
          url: 'https://api.dev/search?q=cats',
          queryString: [{ name: 'q', value: 'cats' }],
        }),
      ]),
    )!
    expect(out[0].spec.url).toBe('https://api.dev/search')
    expect(out[0].spec.query).toEqual([{ name: 'q', value: 'cats' }])
  })

  test('headers import', () => {
    const out = convertHar(
      har([
        entry({
          method: 'GET',
          url: 'https://api.dev/x',
          headers: [{ name: 'Accept', value: 'application/json' }],
        }),
      ]),
    )!
    expect(out[0].spec.headers).toEqual([{ name: 'Accept', value: 'application/json' }])
  })

  test('an entry without a request is skipped, not imported blank', () => {
    const out = convertHar(
      har([{ startedDateTime: '2026-01-01' }, entry({ url: 'https://a.dev/x' })]),
    )!
    expect(out).toHaveLength(1)
  })

  test('a request without a url is skipped', () => {
    expect(convertHar(har([entry({ method: 'GET' })]))!).toEqual([])
  })

  test('HAR carries no auth, so nothing is guessed', () => {
    const out = convertHar(
      har([
        entry({
          method: 'GET',
          url: 'https://api.dev/x',
          headers: [{ name: 'Authorization', value: 'Bearer abc' }],
        }),
      ]),
    )!
    // Left verbatim: a recorded token's scheme is not ours to reinterpret.
    expect(out[0].spec.auth).toEqual({ type: 'none' })
    expect(out[0].spec.headers).toEqual([{ name: 'Authorization', value: 'Bearer abc' }])
  })
})

describe('cookies are not doubled', () => {
  test('cookies[] fold into a Cookie header when there is none', () => {
    const out = convertHar(
      har([entry({ url: 'https://api.dev/x', cookies: [{ name: 'sid', value: 'abc' }] })]),
    )!
    expect(out[0].spec.headers).toEqual([{ name: 'Cookie', value: 'sid=abc' }])
  })

  test('an existing Cookie header wins — a HAR lists both views of the same cookies', () => {
    const out = convertHar(
      har([
        entry({
          url: 'https://api.dev/x',
          headers: [{ name: 'Cookie', value: 'sid=abc' }],
          cookies: [{ name: 'sid', value: 'abc' }],
        }),
      ]),
    )!
    expect(out[0].spec.headers).toEqual([{ name: 'Cookie', value: 'sid=abc' }])
  })
})

describe('body', () => {
  test('postData text imports with its mime type', () => {
    const out = convertHar(
      har([
        entry({
          method: 'POST',
          url: 'https://api.dev/x',
          postData: { mimeType: 'application/json', text: '{"a":1}' },
        }),
      ]),
    )!
    expect(out[0].spec.body).toEqual({ mimeType: 'application/json', text: '{"a":1}' })
  })

  test('postData params import as form pairs', () => {
    const out = convertHar(
      har([
        entry({
          method: 'POST',
          url: 'https://api.dev/x',
          postData: {
            mimeType: 'application/x-www-form-urlencoded',
            params: [{ name: 'a', value: '1' }],
          },
        }),
      ]),
    )!
    expect(out[0].spec.body?.form).toEqual([{ name: 'a', value: '1' }])
  })

  test('a file part imports naming the file — a HAR never archived its bytes', () => {
    const out = convertHar(
      har([
        entry({
          method: 'POST',
          url: 'https://api.dev/x',
          postData: { mimeType: 'multipart/form-data', params: [{ name: 'f', fileName: 'a.png' }] },
        }),
      ]),
    )!
    expect(out[0].spec.body?.form).toEqual([{ name: 'f', value: 'a.png' }])
  })
})

describe('naming', () => {
  test('an entry comment becomes the name', () => {
    const out = convertHar(har([entry({ url: 'https://api.dev/x' }, 'fetch the thing')]))!
    expect(out[0].name).toBe('fetch the thing')
  })

  test('without a comment the url suggests the name', () => {
    const out = convertHar(har([entry({ url: 'https://api.github.com/users/octocat' })]))!
    expect(out[0].name).toBe('api-users-octocat')
  })

  test('a whole session imports at once', () => {
    const out = convertHar(
      har([
        entry({ url: 'https://api.dev/a' }),
        entry({ url: 'https://api.dev/b' }),
        entry({ url: 'https://api.dev/c' }),
      ]),
    )!
    expect(out).toHaveLength(3)
  })
})
