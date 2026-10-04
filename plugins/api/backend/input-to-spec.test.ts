/**
 * `input-to-spec.ts` — the flat/structured impedance mismatch, and until now untested.
 *
 * `overlayInput` is where "send this saved request, but with…" is decided, and one of its lines
 * decides whether an override can replace a SAVED CREDENTIAL. That is worth pinning explicitly,
 * even though the answer turns out to be "yes, deliberately" — an agent's own tool surface is not
 * a privilege boundary (the browser's is, and that is `routes.ts`), but the behaviour should be
 * chosen rather than discovered.
 */

import { describe, expect, test } from 'bun:test'
import {
  authFromInput,
  mergePairs,
  overlayInput,
  specForSend,
  specFromInput,
} from './input-to-spec'
import type { HttpRequestInput } from './http-request-schema'
import type { RequestSpec } from './request-spec'

const input = (over: Partial<HttpRequestInput>): HttpRequestInput =>
  ({ action: 'send', ...over }) as HttpRequestInput

const base = (over: Partial<RequestSpec> = {}): RequestSpec => ({
  url: 'https://api.github.com/user',
  method: 'GET',
  headers: [{ name: 'Accept', value: 'application/json' }],
  query: [{ name: 'page', value: '1' }],
  auth: { type: 'bearer', token: '${secret:GH}' },
  ...over,
})

describe('specFromInput', () => {
  test('a minimal input is a GET', () => {
    expect(specFromInput(input({ url: 'https://api.dev/x' }))).toMatchObject({
      url: 'https://api.dev/x',
      method: 'GET',
      auth: { type: 'none' },
    })
  })

  test('a method is normalised', () => {
    expect(specFromInput(input({ url: 'https://a.dev', method: 'post' })).method).toBe('POST')
  })

  test('an unknown method falls back to GET rather than throwing from a mapper', () => {
    // The fix-it guard rejects this first; the mapper must not be the thing that explodes.
    expect(specFromInput(input({ url: 'https://a.dev', method: 'TRACE' })).method).toBe('GET')
  })

  test('a body defaults to JSON when no contentType is given', () => {
    expect(specFromInput(input({ url: 'https://a.dev', body: '{"a":1}' })).body).toEqual({
      mimeType: 'application/json',
      text: '{"a":1}',
    })
  })

  test('form wins over body — the guard rejects both, so this is belt and braces', () => {
    const spec = specFromInput(input({ url: 'https://a.dev', form: [{ name: 'a', value: '1' }] }))
    expect(spec.body?.form).toEqual([{ name: 'a', value: '1' }])
  })

  test('an empty pathParams list is OMITTED, not stored as []', () => {
    expect('pathParameters' in specFromInput(input({ url: 'https://a.dev' }))).toBe(false)
  })

  test('per-request transport settings are stored', () => {
    expect(
      specFromInput(
        input({
          url: 'https://api.dev',
          followRedirects: false,
          timeoutMs: 60_000,
          maxRedirects: 4,
        }),
      ),
    ).toMatchObject({ followRedirects: false, timeoutMs: 60_000, maxRedirects: 4 })
  })
})

describe('authFromInput', () => {
  test.each([
    [
      { authType: 'bearer', token: 'T' },
      { type: 'bearer', token: 'T' },
    ],
    [
      { authType: 'basic', username: 'ada', password: 'p' },
      { type: 'basic', username: 'ada', password: 'p' },
    ],
    [
      { authType: 'apikey', apiKeyName: 'X-K', apiKeyValue: 'v' },
      { type: 'apikey', key: 'X-K', value: 'v', addTo: 'header' },
    ],
    [{}, { type: 'none' }],
  ] as const)('%j → %j', (over, expected) => {
    expect(authFromInput(input(over as Partial<HttpRequestInput>))).toEqual(expected as never)
  })

  test('apiKeyIn is honoured', () => {
    expect(
      authFromInput(
        input({ authType: 'apikey', apiKeyName: 'k', apiKeyValue: 'v', apiKeyIn: 'query' }),
      ),
    ).toMatchObject({ addTo: 'query' })
  })
})

describe('overlayInput — an ABSENT field keeps the saved value', () => {
  // The point of the whole function: `{"action":"send","name":"x","query":[…]}` must mean "the
  // saved request but with this query", not "a bare GET with everything else lost".
  test('an empty input changes nothing', () => {
    expect(overlayInput(base(), input({}))).toMatchObject({
      url: 'https://api.github.com/user',
      method: 'GET',
    })
  })

  test('a url override wins', () => {
    expect(overlayInput(base(), input({ url: 'https://api.dev/other' })).url).toBe(
      'https://api.dev/other',
    )
  })

  test('a BLANK url does not erase the saved one', () => {
    expect(overlayInput(base(), input({ url: '   ' })).url).toBe('https://api.github.com/user')
  })

  test('a method override wins', () => {
    expect(overlayInput(base(), input({ method: 'DELETE' })).method).toBe('DELETE')
  })

  test('headers MERGE — a saved Accept survives an added X-Request-Id', () => {
    const out = overlayInput(base(), input({ headers: [{ name: 'X-Request-Id', value: 'abc' }] }))
    expect(out.headers).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'X-Request-Id', value: 'abc' },
    ])
  })

  test('an override REPLACES a saved header of the same name', () => {
    const out = overlayInput(base(), input({ headers: [{ name: 'accept', value: 'text/plain' }] }))
    expect(out.headers).toEqual([{ name: 'accept', value: 'text/plain' }])
  })

  test('query merges the same way', () => {
    const out = overlayInput(base(), input({ query: [{ name: 'per_page', value: '5' }] }))
    expect(out.query).toEqual([
      { name: 'page', value: '1' },
      { name: 'per_page', value: '5' },
    ])
  })

  test('a body override wins; no body keeps the saved one', () => {
    const saved = base({ body: { mimeType: 'application/json', text: '{"saved":1}' } })
    expect(overlayInput(saved, input({ body: '{"new":1}' })).body?.text).toBe('{"new":1}')
    expect(overlayInput(saved, input({})).body?.text).toBe('{"saved":1}')
  })

  test('transport overrides win while omitted settings keep the saved values', () => {
    const saved = base({ followRedirects: false, timeoutMs: 10_000, maxRedirects: 2 })
    expect(overlayInput(saved, input({}))).toMatchObject({
      followRedirects: false,
      timeoutMs: 10_000,
      maxRedirects: 2,
    })
    expect(overlayInput(saved, input({ timeoutMs: 60_000, maxRedirects: 8 }))).toMatchObject({
      followRedirects: false,
      timeoutMs: 60_000,
      maxRedirects: 8,
    })
  })
})

describe('overlayInput and the saved credential', () => {
  test('WITHOUT authType, the saved auth is kept — that is what makes send-by-name work', () => {
    // The whole "configure a credential once" story depends on this line.
    expect(overlayInput(base(), input({ query: [{ name: 'a', value: '1' }] })).auth).toEqual({
      type: 'bearer',
      token: '${secret:GH}',
    })
  })

  test('WITH authType, the input REPLACES the saved auth', () => {
    // Deliberate, and worth stating: an agent asking for different auth gets different auth. This
    // is the agent's own tool surface, not a privilege boundary — the browser's edit route is the
    // boundary, and it refuses `auth` from the wire entirely (see routes.ts).
    expect(overlayInput(base(), input({ authType: 'none' })).auth).toEqual({ type: 'none' })
    expect(overlayInput(base(), input({ authType: 'bearer', token: 'other' })).auth).toEqual({
      type: 'bearer',
      token: 'other',
    })
  })

  test('a url override alongside the SAVED auth still carries it — send-by-name with a tweak', () => {
    // The agent CAN point a saved credential at another host. Consistent with the design; it is
    // the same authority that could just send the request itself.
    const out = overlayInput(base(), input({ url: 'https://elsewhere.dev/x' }))
    expect(out.auth).toEqual({ type: 'bearer', token: '${secret:GH}' })
  })
})

describe('mergePairs', () => {
  test('next wins on a case-insensitive clash', () => {
    expect(mergePairs([{ name: 'Accept', value: 'a' }], [{ name: 'accept', value: 'b' }])).toEqual([
      { name: 'accept', value: 'b' },
    ])
  })

  test('order is base-first, then the additions', () => {
    expect(mergePairs([{ name: 'a', value: '1' }], [{ name: 'b', value: '2' }])).toEqual([
      { name: 'a', value: '1' },
      { name: 'b', value: '2' },
    ])
  })

  test('an empty override returns the base unchanged', () => {
    const b = [{ name: 'a', value: '1' }]
    expect(mergePairs(b, [])).toEqual(b)
  })

  test('neither input is mutated', () => {
    const b = [{ name: 'a', value: '1' }]
    const n = [{ name: 'b', value: '2' }]
    mergePairs(b, n)
    expect(b).toHaveLength(1)
    expect(n).toHaveLength(1)
  })
})

describe('specForSend — extracted from a closure precisely because it was untestable', () => {
  // Both branches survived a mutation sweep: neutralised, all 898 tests stayed green. It was a
  // private closure inside `createHttpRequestTool`, reachable only through a tool that needs a
  // ctx, a store and a host — so nothing reached it, and nothing noticed.
  const saved = (over: Partial<RequestSpec> = {}): { spec: RequestSpec } => ({
    spec: {
      url: 'https://api.github.com/user',
      method: 'GET',
      headers: [{ name: 'Accept', value: 'application/vnd.github+json' }],
      query: [],
      auth: { type: 'bearer', token: 't' },
      ...over,
    },
  })

  test('no name → a one-off built from the input alone, and `saved` is ignored', () => {
    const spec = specForSend(input({ url: 'https://a.dev/x', method: 'POST' }), saved())
    expect(spec).toMatchObject({ url: 'https://a.dev/x', method: 'POST' })
  })

  test('a name with no saved request → the message a model reads MOST often', () => {
    // This sentence is the recovery path: it has to name the request AND both ways forward.
    const problem = specForSend(input({ name: 'ghost' }), null)
    expect(typeof problem).toBe('string')
    expect(problem).toContain('"ghost"')
    expect(problem).toContain('"action":"list"')
    expect(problem).toContain('url')
  })

  test.each(['   ', ''])('a blank name %p is a one-off, not a lookup miss', (name) => {
    // Whitespace must not become a request named "   " that can never be found.
    expect(specForSend(input({ name, url: 'https://a.dev' }), null)).toMatchObject({
      url: 'https://a.dev',
    })
  })

  test('a name WITH a saved request → the saved base, overlaid', () => {
    const spec = specForSend(
      input({ name: 'github-user', query: [{ name: 'page', value: '2' }] }),
      saved(),
    )
    expect(spec).toMatchObject({
      url: 'https://api.github.com/user',
      auth: { type: 'bearer', token: 't' },
      query: [{ name: 'page', value: '2' }],
    })
    // …and the saved header survives an override that only adds.
    expect((spec as RequestSpec).headers).toContainEqual({
      name: 'Accept',
      value: 'application/vnd.github+json',
    })
  })
})
