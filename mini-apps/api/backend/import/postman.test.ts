/**
 * The Postman importer.
 *
 * Many of these exist because the reference gets them wrong for a FLAT model, or wrong outright.
 * Each says which, because the tempting "simplification" is to converge back onto it.
 */

import { describe, expect, test } from 'bun:test'
import { convertPostman, convertPostmanCollection, itemName } from './postman'

const V21 = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
const V20 = 'https://schema.getpostman.com/json/collection/v2.0.0/collection.json'

const collection = (over: Record<string, unknown> = {}, schema = V21) =>
  JSON.stringify({ info: { name: 'API', schema }, item: [], ...over })

const req = (name: string, request: Record<string, unknown>) => ({ name, request })
const one = (over: Record<string, unknown>, schema = V21) => {
  const out = convertPostman(collection(over, schema))
  expect(out).not.toBeNull()
  return out!
}

describe('sniffing', () => {
  test.each([V20, V21, 'https://schema.postman.com/json/collection/v2.1.0/collection.json'])(
    'claims %p',
    (schema) => {
      expect(
        convertPostman(collection({ item: [req('x', { url: 'https://a.dev' })] }, schema)),
      ).toHaveLength(1)
    },
  )

  test('a FUTURE v2.x schema is still claimed', () => {
    // A list of exact URLs would make a v2.2 (or a new host, or a stray space) read as
    // "not Postman" and tell the user nothing at all.
    const out = convertPostman(
      collection(
        { item: [req('x', { url: 'https://a.dev' })] },
        'https://schema.postman.com/json/collection/v2.2.0/collection.json',
      ),
    )
    expect(out).toHaveLength(1)
  })

  test.each([
    'curl https://a.dev',
    'not json',
    '{"log":{"entries":[]}}',
    JSON.stringify({ openapi: '3.0.0', paths: {} }),
    JSON.stringify({ info: { name: 'v1 collection' }, requests: [] }),
  ])('%p is not a Postman collection', (text) => {
    expect(convertPostman(text)).toBeNull()
  })
})

describe('auth INHERITS — it is propagated down the item chain', () => {
  // The normal collection: a bearer set once at the top, every request inheriting. Auth is stored
  // per node and resolved at RUNTIME in Postman; a flat model has no chain left to walk, so not
  // propagating it would import fifty requests that all 401 for an invisible reason.
  const bearer = { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}' }] }

  test('a collection-level bearer reaches a request that declares none', () => {
    const out = one({ auth: bearer, item: [req('x', { url: 'https://a.dev' })] })
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('it reaches through nested folders', () => {
    const out = one({
      auth: bearer,
      item: [
        { name: 'v1', item: [{ name: 'users', item: [req('get', { url: 'https://a.dev/u' })] }] },
      ],
    })
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('`auth: {type: "inherit"}` takes the parent’s', () => {
    const out = one({
      auth: bearer,
      item: [req('x', { url: 'https://a.dev', auth: { type: 'inherit' } })],
    })
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('a FOLDER’s auth overrides the collection’s for its children', () => {
    const out = one({
      auth: bearer,
      item: [
        {
          name: 'admin',
          auth: {
            type: 'basic',
            basic: [
              { key: 'username', value: 'ada' },
              { key: 'password', value: 'x' },
            ],
          },
          item: [req('get', { url: 'https://a.dev/admin' })],
        },
        req('public', { url: 'https://a.dev/pub' }),
      ],
    })
    expect(out[0].spec.auth).toMatchObject({ type: 'basic', username: 'ada' })
    // …and does not leak to a sibling outside it.
    expect(out[1].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('a request’s own auth overrides everything above it', () => {
    const out = one({
      auth: bearer,
      item: [
        req('x', {
          url: 'https://a.dev',
          auth: {
            type: 'apikey',
            apikey: [
              { key: 'key', value: 'X-K' },
              { key: 'value', value: 'v' },
            ],
          },
        }),
      ],
    })
    expect(out[0].spec.auth).toMatchObject({ type: 'apikey', key: 'X-K' })
  })

  test('an explicit `noauth` marks a PUBLIC endpoint and beats the inherited token', () => {
    const out = one({
      auth: bearer,
      item: [req('x', { url: 'https://a.dev', auth: { type: 'noauth' } })],
    })
    expect(out[0].spec.auth).toEqual({ type: 'none' })
  })
})

describe('auth shapes: 2.0 object vs 2.1 array', () => {
  test('2.1 reads the {key,value} array', () => {
    const out = one({
      item: [
        req('x', {
          url: 'https://a.dev',
          auth: { type: 'bearer', bearer: [{ key: 'token', value: 'T' }] },
        }),
      ],
    })
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: 'T' })
  })

  test('2.0 reads the bare object — sniffed from the VALUE, not the schema url', () => {
    // Branching on `info.schema` would import a collection blank when its declared version
    // disagrees with its actual shape. `Array.isArray` cannot disagree.
    const out = one(
      {
        item: [
          req('x', { url: 'https://a.dev', auth: { type: 'bearer', bearer: { token: 'T' } } }),
        ],
      },
      V20,
    )
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: 'T' })
  })

  test('a 2.1-shaped auth inside a 2.0-declared collection still reads', () => {
    const out = one(
      {
        item: [
          req('x', {
            url: 'https://a.dev',
            auth: {
              type: 'basic',
              basic: [
                { key: 'username', value: 'ada' },
                { key: 'password', value: 'p' },
              ],
            },
          }),
        ],
      },
      V20,
    )
    expect(out[0].spec.auth).toMatchObject({ type: 'basic', username: 'ada' })
  })

  test('an auth type declared with no payload is not auth', () => {
    const out = one({ item: [req('x', { url: 'https://a.dev', auth: { type: 'basic' } })] })
    expect(out[0].spec.auth).toEqual({ type: 'none' })
  })
})

describe('unsupported auth is reported, never faked', () => {
  test.each(['oauth2', 'awsv4', 'digest', 'oauth1', 'ntlm'])(
    '%s imports as none and is named',
    (type) => {
      const out = convertPostmanCollection(
        collection({ item: [req('x', { url: 'https://a.dev', auth: { type } })] }),
      )!
      expect(out.requests[0].spec.auth).toEqual({ type: 'none' })
      expect(out.notes.unsupportedAuth).toContain(type)
    },
  )
})

describe('url', () => {
  test('a string url', () => {
    expect(one({ item: [req('x', { url: 'https://a.dev/u' })] })[0].spec.url).toBe(
      'https://a.dev/u',
    )
  })

  test('raw wins — it is what the author typed, {{vars}} and all', () => {
    const out = one({ item: [req('x', { url: { raw: 'https://{{host}}/u', host: ['ignored'] } })] })
    expect(out[0].spec.url).toBe('https://{{host}}/u')
  })

  test('the url is REBUILT from parts when raw is missing', () => {
    // Returning '' here would lose the request's url entirely — a shape Postman emits.
    const out = one({
      item: [
        req('x', { url: { protocol: 'https', host: ['api', 'a', 'dev'], path: ['v1', 'users'] } }),
      ],
    })
    expect(out[0].spec.url).toBe('https://api.a.dev/v1/users')
  })

  test('a rebuilt url carries its port', () => {
    const out = one({
      item: [req('x', { url: { host: ['localhost'], port: '8080', path: ['x'] } })],
    })
    expect(out[0].spec.url).toBe('https://localhost:8080/x')
  })

  test('query params are extracted and the querystring stripped once', () => {
    const out = one({
      item: [
        req('x', { url: { raw: 'https://a.dev/s?q=cats', query: [{ key: 'q', value: 'cats' }] } }),
      ],
    })
    expect(out[0].spec.url).toBe('https://a.dev/s')
    expect(out[0].spec.query).toEqual([{ name: 'q', value: 'cats' }])
  })

  test('an EMPTY query array does not eat the raw querystring', () => {
    // Stripping whenever `url.query` is truthy — and `[]` is truthy — would make the querystring
    // vanish with nothing to replace it.
    const out = one({ item: [req('x', { url: { raw: 'https://a.dev/s?q=cats', query: [] } })] })
    expect(out[0].spec.url).toBe('https://a.dev/s?q=cats')
  })

  test('path variables come across', () => {
    const out = one({
      item: [
        req('x', { url: { raw: 'https://a.dev/u/:id', variable: [{ key: 'id', value: '42' }] } }),
      ],
    })
    expect(out[0].spec.pathParameters).toEqual([{ name: 'id', value: '42' }])
  })

  test('an item with no usable url is skipped, not imported blank', () => {
    expect(one({ item: [req('x', { url: {} }), req('y', { url: 'https://a.dev' })] })).toHaveLength(
      1,
    )
  })

  test('a bare-string request is a GET', () => {
    const out = one({ item: [{ name: 'x', request: 'https://a.dev/u' }] })
    expect(out[0].spec).toMatchObject({ url: 'https://a.dev/u', method: 'GET' })
  })
})

describe('the enabled/disabled split between 2.0 and 2.1', () => {
  test('2.1 `disabled: true` is off', () => {
    const out = one({
      item: [
        req('x', {
          url: { raw: 'https://a.dev', query: [{ key: 'a', value: '1', disabled: true }] },
        }),
      ],
    })
    expect(out[0].spec.query[0]).toEqual({ name: 'a', value: '1', disabled: true })
  })

  test('2.0 `enabled: false` is off', () => {
    const out = one(
      {
        item: [
          req('x', {
            url: { raw: 'https://a.dev', query: [{ key: 'a', value: '1', enabled: false }] },
          }),
        ],
      },
      V20,
    )
    expect(out[0].spec.query[0].disabled).toBe(true)
  })

  test('an OMITTED flag means ENABLED — in both versions', () => {
    // Computing `disabled = !enabled` would make a param that simply omits `enabled` (the common
    // case; Postman's own default is true) import disabled and stop being sent.
    for (const schema of [V20, V21]) {
      const out = one(
        { item: [req('x', { url: { raw: 'https://a.dev', query: [{ key: 'a', value: '1' }] } })] },
        schema,
      )
      expect(out[0].spec.query[0].disabled).toBeUndefined()
    }
  })
})

describe('body', () => {
  const withBody = (body: unknown) =>
    one({ item: [req('x', { url: 'https://a.dev', method: 'POST', body })] })[0].spec.body

  test('raw + json language', () => {
    expect(
      withBody({ mode: 'raw', raw: '{"a":1}', options: { raw: { language: 'json' } } }),
    ).toEqual({
      mimeType: 'application/json',
      text: '{"a":1}',
    })
  })

  test.each([
    ['xml', 'application/xml'],
    ['html', 'text/html'],
    ['javascript', 'application/javascript'],
    ['text', 'text/plain'],
    [undefined, 'text/plain'],
  ])('raw language %p → %p', (language, mime) => {
    // Mapping only xml/json would flatten html and javascript to text/plain.
    const body = withBody({
      mode: 'raw',
      raw: 'x',
      ...(language ? { options: { raw: { language } } } : {}),
    })
    expect(body?.mimeType).toBe(mime)
  })

  test('urlencoded → form pairs', () => {
    expect(withBody({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] })?.form).toEqual([
      { name: 'a', value: '1' },
    ])
  })

  test('formdata → multipart', () => {
    expect(withBody({ mode: 'formdata', formdata: [{ key: 'a', value: '1' }] })?.mimeType).toBe(
      'multipart/form-data',
    )
  })

  test('a graphql body imports as the JSON POST it always was on the wire', () => {
    // This mini app no longer has a GraphQL feature, and this import lost nothing by it.
    // `{query, variables}` over `application/json` is what graphql-over-http specifies, and it is
    // exactly what went out before: the old `application/graphql` mimeType was an internal marker
    // that `encodeBody` translated to JSON at send time. Same bytes, one fewer concept.
    const body = withBody({ mode: 'graphql', graphql: { query: '{ x }', variables: '{"a":1}' } })
    expect(body?.mimeType).toBe('application/json')
    expect(JSON.parse(body!.text!)).toEqual({ query: '{ x }', variables: '{"a":1}' })
  })

  test('a graphql body with no query is dropped rather than imported empty', () => {
    expect(withBody({ mode: 'graphql', graphql: { variables: '{"a":1}' } })).toBeUndefined()
  })

  test('a FILE body is dropped, and SAID so', () => {
    // Returning {} would make the body vanish with no sign. The bytes were never in the
    // collection, so it cannot survive — but the request must not quietly become a payload-less POST.
    const out = convertPostmanCollection(
      collection({
        item: [
          req('upload', {
            url: 'https://a.dev',
            method: 'POST',
            body: { mode: 'file', file: { src: '/tmp/x' } },
          }),
        ],
      }),
    )!
    expect(out.requests[0].spec.body).toBeUndefined()
    expect(out.notes.droppedBodies).toContain('upload')
  })

  test('an empty raw body is no body', () => {
    expect(withBody({ mode: 'raw', raw: '' })).toBeUndefined()
  })
})

describe('{{variables}} need no translation — that is the payoff', () => {
  test('a plain variable survives verbatim', () => {
    const out = one({ item: [req('x', { url: '{{base_url}}/users' })] })
    expect(out[0].spec.url).toBe('{{base_url}}/users')
  })

  test('a HYPHENATED name survives too', () => {
    // In an expression language bare `{{my-var}}` is subtraction and would need rewriting. Our
    // substitution is not an expression language, so none of that exists.
    const out = one({ item: [req('x', { url: '{{my-var}}/users' })] })
    expect(out[0].spec.url).toBe('{{my-var}}/users')
  })

  test('a hyphen elsewhere does not disturb a variable', () => {
    const out = one({ item: [req('x', { url: 'https://a.dev/well-known/{{id}}' })] })
    expect(out[0].spec.url).toBe('https://a.dev/well-known/{{id}}')
  })

  test('collection variables are reported — they map onto our environments', () => {
    const out = convertPostmanCollection(
      collection({
        variable: [{ key: 'base_url', value: 'https://a.dev' }],
        item: [req('x', { url: '{{base_url}}/u' })],
      }),
    )!
    expect(out.notes.variables).toEqual([{ name: 'base_url', value: 'https://a.dev' }])
  })
})

describe('{{$dynamic}} variables are REPORTED, not faked', () => {
  test('a dynamic variable in a url is named', () => {
    // Ours does not even MATCH `$`-prefixed names, so without this the request would import,
    // resolve nothing, be reported missing nothing, and send a literal `{{$randomInt}}`.
    const out = convertPostmanCollection(
      collection({ item: [req('x', { url: 'https://a.dev/{{$randomInt}}' })] }),
    )!
    expect(out.notes.dynamic).toEqual(['randomInt'])
  })

  test('they are found in headers and bodies too', () => {
    const out = convertPostmanCollection(
      collection({
        item: [
          req('x', {
            url: 'https://a.dev',
            method: 'POST',
            header: [{ key: 'X-Id', value: '{{$guid}}' }],
            body: {
              mode: 'raw',
              raw: '{"at":"{{$isoTimestamp}}"}',
              options: { raw: { language: 'json' } },
            },
          }),
        ],
      }),
    )!
    expect(out.notes.dynamic.sort()).toEqual(['guid', 'isoTimestamp'])
  })

  test('an ordinary variable is not mistaken for a dynamic one', () => {
    const out = convertPostmanCollection(
      collection({ item: [req('x', { url: '{{base_url}}/u' })] }),
    )!
    expect(out.notes.dynamic).toEqual([])
  })
})

describe('folders → flat names', () => {
  test('the folder path prefixes the name', () => {
    const out = one({
      item: [{ name: 'Users', item: [req('Get user', { url: 'https://a.dev/u' })] }],
    })
    expect(out[0].name).toBe('users-get-user')
  })

  test('nested folders all contribute', () => {
    const out = one({
      item: [
        { name: 'v1', item: [{ name: 'Users', item: [req('List', { url: 'https://a.dev' })] }] },
      ],
    })
    expect(out[0].name).toBe('v1-users-list')
  })

  test('a top-level request has no prefix', () => {
    expect(one({ item: [req('Ping', { url: 'https://a.dev' })] })[0].name).toBe('ping')
  })

  test.each([
    [[], undefined, 'request'],
    [['a'], '', 'a-request'],
    [['Users'], 'Get user', 'users-get-user'],
  ] as const)('itemName(%j, %p) → %p', (path, name, expected) => {
    expect(itemName(path, name)).toBe(expected)
  })
})

describe('malformed collections do not throw', () => {
  test.each([
    { item: null },
    { item: [null, undefined, 42] },
    { item: [{ name: 'folder' }] },
    { item: [{ name: 'folder', item: null }] },
    { item: [req('x', {})] },
  ])('%j', (over) => {
    expect(() => convertPostman(collection(over))).not.toThrow()
  })

  test('a deeply nested collection terminates', () => {
    let node: Record<string, unknown> = { name: 'leaf', item: [req('x', { url: 'https://a.dev' })] }
    for (let i = 0; i < 40; i++) node = { name: `f${i}`, item: [node] }
    expect(() => convertPostman(collection({ item: [node] }))).not.toThrow()
  })
})
