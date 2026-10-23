/**
 * `encodeBody` — what actually goes on the wire. The claim worth pinning:
 * the stored marker must NOT be the content-type we send.
 */

import { describe, expect, test } from 'bun:test'
import { encodeBody, reportUrl } from './send'
import { credentialQueryParam } from './auth'
import type { RequestSpec } from './request-spec'

const spec = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.dev/x',
  method: 'POST',
  headers: [],
  query: [],
  auth: { type: 'none' },
  ...over,
})

describe('other bodies are untouched', () => {
  test('json passes through with its own type', () => {
    const out = encodeBody(spec({ body: { mimeType: 'application/json', text: '{"a":1}' } }))
    expect(out).toEqual({ body: '{"a":1}', contentType: 'application/json' })
  })

  test('a form is url-encoded', () => {
    const out = encodeBody(
      spec({
        body: { mimeType: 'application/x-www-form-urlencoded', form: [{ name: 'a', value: '1' }] },
      }),
    )
    expect(out).toEqual({ body: 'a=1', contentType: 'application/x-www-form-urlencoded' })
  })

  test('a vendor json type is NOT rewritten — it is a real negotiation', () => {
    const out = encodeBody(spec({ body: { mimeType: 'application/vnd.api+json', text: '{}' } }))
    expect(out.contentType).toBe('application/vnd.api+json')
  })

  test('no body is nothing', () => {
    expect(encodeBody(spec())).toEqual({})
  })
})

describe('a credential IN the url is masked out of what we report', () => {
  // THE BUG THIS EXISTS FOR: `apikey` + `addTo: 'query'` puts a RESOLVED secret into the url. That
  // is right on the wire and a disaster everywhere else — `url` and `hops` are printed to the model
  // (a persisted transcript) and returned to the browser (a devtools network tab). The vault's
  // whole promise is that the value never leaves the process, and for this one auth type it walked
  // out in the first line of every response. Shipped in iteration 1, found in review at iteration 15.
  const apikeyQuery = (key = 'api_key'): RequestSpec =>
    spec({
      url: 'https://api.dev/things',
      auth: { type: 'apikey', key, value: 'sk_live_SECRET', addTo: 'query' },
    })

  test('the reported url masks the credential', () => {
    const reported = reportUrl(
      new URL('https://api.dev/things?api_key=sk_live_SECRET'),
      apikeyQuery(),
    )
    expect(reported).not.toContain('sk_live_SECRET')
    expect(reported).toContain('api_key=REDACTED')
  })

  test('the mask is url-safe — a bullet would percent-encode into noise', () => {
    expect(reportUrl(new URL('https://api.dev/x?api_key=s'), apikeyQuery())).not.toContain(
      '%E2%80%A2',
    )
  })

  test('other query params are untouched', () => {
    const reported = reportUrl(
      new URL('https://api.dev/x?page=2&api_key=sk_live_SECRET'),
      apikeyQuery(),
    )
    expect(reported).toContain('page=2')
    expect(reported).not.toContain('sk_live_SECRET')
  })

  test('an apikey in a HEADER leaves the url alone — nothing to mask there', () => {
    const headerAuth = spec({
      url: 'https://api.dev/x?page=2',
      auth: { type: 'apikey', key: 'X-Api-Key', value: 's', addTo: 'header' },
    })
    expect(reportUrl(new URL('https://api.dev/x?page=2'), headerAuth)).toBe(
      'https://api.dev/x?page=2',
    )
  })

  test.each([
    { type: 'none' },
    { type: 'bearer', token: 't' },
    { type: 'basic', username: 'a', password: 'p' },
  ] as const)('%j carries no credential in the url', (auth) => {
    const url = 'https://api.dev/x?page=2'
    expect(reportUrl(new URL(url), spec({ url, auth: auth as never }))).toBe(url)
  })

  test('a url that does NOT carry the param is returned unchanged', () => {
    // e.g. a redirect hop to another origin, after the query was dropped.
    expect(reportUrl(new URL('https://other.dev/x'), apikeyQuery())).toBe('https://other.dev/x')
  })

  test('the param name is taken from the AUTH, not guessed', () => {
    const reported = reportUrl(
      new URL('https://api.dev/x?token=sk_live_SECRET'),
      apikeyQuery('token'),
    )
    expect(reported).toContain('token=REDACTED')
  })

  test('conventional inline query credentials are masked without an auth configuration', () => {
    const reported = reportUrl(
      new URL('https://api.dev/x?access_token=top-secret&page=2'),
      spec({ method: 'GET' }),
    )
    expect(reported).toBe('https://api.dev/x?access_token=REDACTED&page=2')
  })

  test('userinfo credentials are masked too', () => {
    const reported = reportUrl(
      new URL('https://client:top-secret@api.dev/x'),
      spec({ method: 'GET' }),
    )
    expect(reported).toBe('https://REDACTED:REDACTED@api.dev/x')
  })
})

describe('credentialQueryParam', () => {
  test('only apikey-in-query names one', () => {
    expect(credentialQueryParam({ type: 'apikey', key: 'k', value: 'v', addTo: 'query' })).toBe('k')
  })

  test.each([
    { type: 'apikey', key: 'k', value: 'v', addTo: 'header' },
    { type: 'apikey', key: 'k', value: 'v', addTo: 'cookie' },
    { type: 'apikey', key: 'k', value: 'v' },
    { type: 'bearer', token: 't' },
    { type: 'none' },
  ] as const)('%j names none', (auth) => {
    expect(credentialQueryParam(auth as never)).toBeNull()
  })
})

describe('multipart is its own encoding, not urlencoded with a different label', () => {
  // The bug: `bodyIsForm` is true for BOTH encodings, and `encodeBody` had one branch — it built
  // URLSearchParams and hardcoded the urlencoded content-type for either. A Postman `formdata`
  // import (which postman.ts maps to multipart/form-data, and postman.test.ts asserts) therefore
  // went out urlencoded, and the server 400'd or misparsed with nothing saying why. Verified
  // against a live echo server before and after.
  const multipart = spec({
    body: { mimeType: 'multipart/form-data', form: [{ name: 'a', value: '1' }] },
  })

  test('a multipart body is a FormData, not a query string', () => {
    expect(encodeBody(multipart).body).toBeInstanceOf(FormData)
  })

  test('it sets NO content-type — the runtime must write the boundary', () => {
    // A hand-written `multipart/form-data` with no boundary is unparseable. Leaving it unset is
    // what lets fetch emit `multipart/form-data; boundary=…`.
    expect(encodeBody(multipart).contentType).toBeUndefined()
  })

  test('the fields survive', () => {
    const form = encodeBody(
      spec({
        body: {
          mimeType: 'multipart/form-data',
          form: [
            { name: 'a', value: '1' },
            { name: 'b', value: '2' },
          ],
        },
      }),
    ).body as FormData
    expect(form.get('a')).toBe('1')
    expect(form.get('b')).toBe('2')
  })

  test('a disabled field is not sent', () => {
    const form = encodeBody(
      spec({
        body: {
          mimeType: 'multipart/form-data',
          form: [
            { name: 'a', value: '1' },
            { name: 'skip', value: '2', disabled: true },
          ],
        },
      }),
    ).body as FormData
    expect(form.has('skip')).toBe(false)
  })

  test('urlencoded is STILL urlencoded — the two did not swap', () => {
    const out = encodeBody(
      spec({
        body: { mimeType: 'application/x-www-form-urlencoded', form: [{ name: 'a', value: '1' }] },
      }),
    )
    expect(out.body).toBe('a=1')
    expect(out.contentType).toBe('application/x-www-form-urlencoded')
  })

  test('a charset on the multipart type still reads as multipart', () => {
    expect(
      encodeBody(spec({ body: { mimeType: 'multipart/form-data; charset=utf-8', form: [] } })).body,
    ).toBeInstanceOf(FormData)
  })
})

describe('repeated request headers', () => {
  test('send combines repeatable fields and cookies without losing a row', async () => {
    const originalFetch = globalThis.fetch
    const received: Headers[] = []
    globalThis.fetch = Object.assign(
      async (_url: URL | RequestInfo, init?: BunFetchRequestInit | RequestInit) => {
        received.push(new Headers(init?.headers))
        return new Response('ok', { status: 200 })
      },
      { preconnect: originalFetch.preconnect },
    )
    try {
      const { sendRequest } = await import('./send')
      await sendRequest(
        spec({
          method: 'GET',
          headers: [
            { name: 'X-Tag', value: 'one' },
            { name: 'x-tag', value: 'two' },
            { name: 'Cookie', value: 'a=1' },
            { name: 'cookie', value: 'b=2' },
          ],
        }),
        { timeoutMs: 1_000, maxBodyBytes: 1_000, allowPrivateNetwork: true },
      )
      expect(received[0]?.get('x-tag')).toBe('one, two')
      expect(received[0]?.get('cookie')).toBe('a=1; b=2')
    } finally {
      globalThis.fetch = originalFetch
    }
  })
})
