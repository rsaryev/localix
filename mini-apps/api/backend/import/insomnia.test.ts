/**
 * The Insomnia export importer.
 *
 * Most fields map directly. The important exceptions are auth inheritance and normalization of the
 * `{{ _.var }}` namespace.
 */

import { describe, expect, test } from 'bun:test'
import {
  convertAuth,
  insomniaEnvironments,
  insomniaNotes,
  inheritHeaders,
  convertInsomnia,
  convertInsomniaExport,
  normaliseTemplating,
  resourceName,
} from './insomnia'

const wrk = { _id: 'wrk_1', _type: 'workspace', parentId: null, name: 'W' }
const exp = (resources: unknown[], format = 4) =>
  JSON.stringify({ _type: 'export', __export_format: format, resources: [wrk, ...resources] })

const req = (over: Record<string, unknown> = {}) => ({
  _id: 'req_1',
  _type: 'request',
  parentId: 'wrk_1',
  name: 'Get user',
  method: 'GET',
  url: 'https://api.github.com/user',
  ...over,
})

const one = (resources: unknown[], format = 4) => {
  const out = convertInsomnia(exp(resources, format))
  expect(out).not.toBeNull()
  return out!
}

describe('sniffing', () => {
  test.each([2, 3, 4])('__export_format %i is claimed', (format) => {
    expect(convertInsomnia(exp([req()], format))).toHaveLength(1)
  })

  test('a v4 YAML export is claimed — v4 exports as YAML', () => {
    const yaml = `
_type: export
__export_format: 4
resources:
  - _id: wrk_1
    _type: workspace
    parentId: null
  - _id: req_1
    _type: request
    parentId: wrk_1
    name: Get user
    method: GET
    url: https://api.github.com/user
`
    expect(convertInsomnia(yaml)).toHaveLength(1)
  })

  test.each([
    'curl https://a.dev',
    'not json',
    '{"log":{"entries":[]}}',
    JSON.stringify({ openapi: '3.0.0', paths: {} }),
    JSON.stringify({
      info: { schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
    }),
    JSON.stringify({ __export_format: 99, resources: [] }),
    JSON.stringify({ resources: [] }),
  ])('%p is not an Insomnia export', (text) => {
    expect(convertInsomnia(text)).toBeNull()
  })

  test('an export with only a workspace yields nothing, and that is correct', () => {
    // A workspace without request resources has nothing to import.
    expect(convertInsomnia(exp([]))).toEqual([])
  })
})

describe('compatible fields map directly', () => {
  test('url, method, headers, query and path params come across as-is', () => {
    const out = one([
      req({
        method: 'post',
        url: 'https://api.dev/u/:id',
        headers: [{ name: 'Accept', value: 'application/json' }],
        parameters: [{ name: 'page', value: '2' }],
        pathParameters: [{ name: 'id', value: '42' }],
      }),
    ])
    expect(out[0].spec).toMatchObject({
      url: 'https://api.dev/u/:id',
      method: 'POST',
      headers: [{ name: 'Accept', value: 'application/json' }],
      query: [{ name: 'page', value: '2' }],
      pathParameters: [{ name: 'id', value: '42' }],
    })
  })

  test('the `:id` path grammar needs no rewrite', () => {
    // Preserve the placeholder so the shared request grammar can fill it at send time.
    expect(one([req({ url: 'https://api.dev/u/:id' })])[0].spec.url).toContain('/:id')
  })

  test('a disabled pair keeps its flag', () => {
    const out = one([req({ headers: [{ name: 'X', value: '1', disabled: true }] })])
    expect(out[0].spec.headers[0]).toEqual({ name: 'X', value: '1', disabled: true })
  })

  test('a v3+ body object', () => {
    const out = one([req({ body: { mimeType: 'application/json', text: '{"a":1}' } })])
    expect(out[0].spec.body).toEqual({ mimeType: 'application/json', text: '{"a":1}' })
  })

  test('a form body', () => {
    const out = one([
      req({
        body: {
          mimeType: 'application/x-www-form-urlencoded',
          params: [{ name: 'a', value: '1' }],
        },
      }),
    ])
    expect(out[0].spec.body?.form).toEqual([{ name: 'a', value: '1' }])
  })

  test('a v2 STRING body is repaired into the object shape', () => {
    // v2 wrote `body` as a bare string; the request model expects the object form.
    const out = one([req({ body: 'raw text' })], 2)
    expect(out[0].spec.body).toEqual({ text: 'raw text' })
  })

  test('an empty v2 body is no body', () => {
    expect(one([req({ body: '' })], 2)[0].spec.body).toBeUndefined()
  })
})

describe('auth inherits through parentId during import', () => {
  // The export is flat, but `authentication: {}` inherits through request groups. The saved model
  // has no parent chain to walk later, so the importer must materialize inherited auth.
  const bearer = { type: 'bearer', token: '{{ _.token }}' }

  test('a FOLDER-level bearer reaches a request that declares none', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          wrk,
          {
            _id: 'grp_1',
            _type: 'request_group',
            parentId: 'wrk_1',
            name: 'Users',
            authentication: bearer,
          },
          req({ parentId: 'grp_1', authentication: {} }),
        ],
      }),
    )!
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('a workspace-level bearer is honoured even though ordinary exports omit it', () => {
    // The workspace model has no `authentication` field, but a hand-edited export can contain one.
    // Honouring a credential explicitly written in the file avoids silently dropping it.
    const out = one([{ ...wrk, authentication: bearer } as never, req({ authentication: {} })])
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('it reaches through a folder', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          { ...wrk, authentication: bearer },
          { _id: 'grp_1', _type: 'request_group', parentId: 'wrk_1', name: 'Users' },
          req({ parentId: 'grp_1', authentication: {} }),
        ],
      }),
    )!
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('a FOLDER overrides the workspace for its children', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          { ...wrk, authentication: bearer },
          {
            _id: 'grp_1',
            _type: 'request_group',
            parentId: 'wrk_1',
            name: 'Admin',
            authentication: { type: 'basic', username: 'ada', password: 'p' },
          },
          req({ parentId: 'grp_1', authentication: {} }),
          req({ _id: 'req_2', name: 'Public', parentId: 'wrk_1', authentication: {} }),
        ],
      }),
    )!
    expect(out[0].spec.auth).toMatchObject({ type: 'basic', username: 'ada' })
    // …and does not leak to a sibling outside it.
    expect(out[1].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test("a request's own auth wins", () => {
    const out = one([
      { ...wrk, authentication: bearer } as never,
      req({ authentication: { type: 'apikey', key: 'X-K', value: 'v' } }),
    ])
    expect(out[0].spec.auth).toMatchObject({ type: 'apikey', key: 'X-K' })
  })

  test('a DISABLED auth block means none — it is not inheritance', () => {
    const out = one([
      { ...wrk, authentication: bearer } as never,
      req({ authentication: { type: 'bearer', token: 't', disabled: true } }),
    ])
    expect(out[0].spec.auth).toEqual({ type: 'none' })
  })

  test('a parentId CYCLE terminates rather than hanging', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          { _id: 'a', _type: 'request_group', parentId: 'b', name: 'A' },
          { _id: 'b', _type: 'request_group', parentId: 'a', name: 'B' },
          req({ parentId: 'a', authentication: {} }),
        ],
      }),
    )
    expect(out).toHaveLength(1)
  })
})

describe('convertAuth', () => {
  test.each([
    [
      { type: 'bearer', token: 'T' },
      { type: 'bearer', token: 'T' },
    ],
    [
      { type: 'basic', username: 'a', password: 'p' },
      { type: 'basic', username: 'a', password: 'p' },
    ],
    [
      { type: 'apikey', key: 'K', value: 'v', addTo: 'query' },
      { type: 'apikey', key: 'K', value: 'v', addTo: 'query' },
    ],
    [{ type: 'none' }, { type: 'none' }],
  ] as const)('%j → %j', (auth, expected) => {
    expect(convertAuth(auth as never).auth).toEqual(expected as never)
  })

  test('`{}` is INHERIT, not none — null lets the caller walk the chain', () => {
    expect(convertAuth({}).auth).toBeNull()
    expect(convertAuth(undefined).auth).toBeNull()
  })

  test.each(['oauth2', 'oauth1', 'digest', 'ntlm', 'iam', 'asap', 'hawk', 'netrc'])(
    '%s is reported, never faked',
    (type) => {
      const out = convertAuth({ type })
      expect(out.auth).toBeNull()
      expect(out.unsupported).toBe(type)
    },
  )

  test('an unsupported auth on a request imports as none AND is named', () => {
    const out = convertInsomniaExport(exp([req({ authentication: { type: 'oauth2' } })]))!
    expect(out.requests[0].spec.auth).toEqual({ type: 'none' })
    expect(out.notes.unsupportedAuth).toContain('oauth2')
  })
})

describe('Insomnia variable namespaces normalize to local variables', () => {
  // Insomnia's nunjucks namespaces variables under `_`. Left alone, our substitution would read
  // `{{ _.base_url }}` as a variable NAMED `_.base_url` — which no environment defines — and every
  // send would report it missing.
  test.each([
    ['{{ _.base_url }}/users', '{{base_url}}/users'],
    ['{{_.token}}', '{{token}}'],
    // The bracket form represents hyphenated names.
    ["{{ _['my-var'] }}/x", '{{my-var}}/x'],
    ['{{ _["my-var"] }}', '{{my-var}}'],
    // Local syntax is untouched.
    ['{{ base_url }}/users', '{{ base_url }}/users'],
    ['{{base_url}}', '{{base_url}}'],
    // Nothing to do.
    ['https://api.dev/x', 'https://api.dev/x'],
    ['', ''],
  ])('%p → %p', (raw, expected) => {
    expect(normaliseTemplating(raw)).toBe(expected)
  })

  test('it is applied to the url', () => {
    expect(one([req({ url: '{{ _.base_url }}/users' })])[0].spec.url).toBe('{{base_url}}/users')
  })

  test('…to headers, query, path params and the body', () => {
    const out = one([
      req({
        headers: [{ name: 'X-Key', value: '{{ _.key }}' }],
        parameters: [{ name: 'v', value: '{{ _.ver }}' }],
        pathParameters: [{ name: 'id', value: '{{ _.id }}' }],
        body: { mimeType: 'application/json', text: '{"a":"{{ _.a }}"}' },
      }),
    ])
    expect(out[0].spec.headers[0].value).toBe('{{key}}')
    expect(out[0].spec.query[0].value).toBe('{{ver}}')
    expect(out[0].spec.pathParameters![0].value).toBe('{{id}}')
    expect(out[0].spec.body?.text).toBe('{"a":"{{a}}"}')
  })

  test('…and to an inherited auth token', () => {
    const out = one([
      { ...wrk, authentication: { type: 'bearer', token: '{{ _.token }}' } } as never,
      req({ authentication: {} }),
    ])
    expect(out[0].spec.auth).toEqual({ type: 'bearer', token: '{{token}}' })
  })

  test('a `{% tag %}` is NOT translated — we have no engine to run it', () => {
    const out = convertInsomniaExport(exp([req({ url: "https://api.dev/{% faker 'guid' %}" })]))!
    expect(out.requests[0].spec.url).toContain('{% faker')
    expect(out.notes.tags).toEqual(['faker'])
  })

  test('a response-chaining tag is reported too', () => {
    const out = convertInsomniaExport(
      exp([req({ headers: [{ name: 'X', value: "{% response 'body', 'req_2', '$.id' %}" }] })]),
    )!
    expect(out.notes.tags).toEqual(['response'])
  })
})

describe('folders → flat names', () => {
  test('a folder path prefixes the name', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          wrk,
          { _id: 'grp_1', _type: 'request_group', parentId: 'wrk_1', name: 'Users' },
          req({ parentId: 'grp_1', name: 'Get user' }),
        ],
      }),
    )!
    expect(out[0].name).toBe('users-get-user')
  })

  test('nested folders all contribute, outermost first', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          wrk,
          { _id: 'g1', _type: 'request_group', parentId: 'wrk_1', name: 'v1' },
          { _id: 'g2', _type: 'request_group', parentId: 'g1', name: 'Users' },
          req({ parentId: 'g2', name: 'List' }),
        ],
      }),
    )!
    expect(out[0].name).toBe('v1-users-list')
  })

  test('the WORKSPACE contributes no segment — it is the root, not a folder', () => {
    expect(one([req({ name: 'Ping' })])[0].name).toBe('ping')
  })

  test.each([
    [[], undefined, 'request'],
    [['Users'], 'Get user', 'users-get-user'],
  ] as const)('resourceName(%j, %p) → %p', (path, name, expected) => {
    expect(resourceName(path, name)).toBe(expected)
  })
})

describe('environments come across as ours', () => {
  test('an environment resource is reported with its variables', () => {
    const out = convertInsomniaExport(
      exp([
        req(),
        {
          _id: 'env_1',
          _type: 'environment',
          parentId: 'wrk_1',
          name: 'Prod',
          data: { base_url: 'https://api.dev', n: 5 },
        },
      ]),
    )!
    expect(out.notes.environments).toEqual([
      {
        name: 'Prod',
        variables: [
          { name: 'base_url', value: 'https://api.dev' },
          { name: 'n', value: '5' },
        ],
      },
    ])
  })

  test('environment resources are imported as data', () => {
    // Assert the exact mapping rather than merely checking that an explanatory note exists.
    const envs = insomniaEnvironments(
      exp([
        req(),
        {
          _id: 'e',
          _type: 'environment',
          parentId: 'wrk_1',
          name: 'Prod',
          data: { base_url: 'https://api.dev' },
        },
      ]),
    )
    expect(envs).toEqual([
      { name: 'Prod', variables: [{ name: 'base_url', value: 'https://api.dev' }] },
    ])
  })

  test('and the notes no longer ask anyone to retype them', () => {
    const notes = insomniaNotes(
      exp([
        req(),
        { _id: 'e', _type: 'environment', parentId: 'wrk_1', name: 'Prod', data: { a: '1' } },
      ]),
    )
    expect(notes.join(' ')).not.toContain('manage_environment')
  })

  test('an environment with no usable variables is not reported', () => {
    const out = convertInsomniaExport(
      exp([req(), { _id: 'e', _type: 'environment', parentId: 'wrk_1', name: 'E', data: {} }]),
    )!
    expect(out.notes.environments).toEqual([])
  })
})

describe('malformed exports do not throw', () => {
  test.each([
    JSON.stringify({ __export_format: 4, resources: null }),
    JSON.stringify({ __export_format: 4, resources: [null, 42, {}] }),
    JSON.stringify({ __export_format: 4, resources: [{ _type: 'request' }] }),
    JSON.stringify({
      __export_format: 4,
      resources: [{ _type: 'request', url: 'x', parentId: 'ghost' }],
    }),
  ])('%p', (text) => {
    expect(() => convertInsomnia(text)).not.toThrow()
  })

  test('a request with no url is skipped, not imported blank', () => {
    expect(one([req({ url: undefined }), req({ _id: 'r2', name: 'ok' })])).toHaveLength(1)
  })
})

describe('headers inherit through parentId during import', () => {
  // Folder-level headers must be materialized because the saved model has no parent chain to walk
  // later. Otherwise a header configured once for a group silently disappears from every child.
  const withFolder = (folderHeaders: unknown, requestHeaders: unknown = []) =>
    convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          wrk,
          {
            _id: 'grp_1',
            _type: 'request_group',
            parentId: 'wrk_1',
            name: 'Users',
            headers: folderHeaders,
          },
          req({ parentId: 'grp_1', headers: requestHeaders }),
        ],
      }),
    )!

  test("a folder's header reaches the request", () => {
    const out = withFolder([{ name: 'X-Api-Key', value: 'k' }])
    expect(out[0].spec.headers).toEqual([{ name: 'X-Api-Key', value: 'k' }])
  })

  test('the folder header and the request header both survive', () => {
    const out = withFolder([{ name: 'X-Api-Key', value: 'k' }], [{ name: 'X-Trace', value: '1' }])
    expect(out[0].spec.headers).toEqual([
      { name: 'X-Api-Key', value: 'k' },
      { name: 'X-Trace', value: '1' },
    ])
  })

  test('outermost first, then inner, then the request', () => {
    const out = convertInsomnia(
      JSON.stringify({
        __export_format: 4,
        resources: [
          wrk,
          {
            _id: 'g1',
            _type: 'request_group',
            parentId: 'wrk_1',
            name: 'v1',
            headers: [{ name: 'A', value: '1' }],
          },
          {
            _id: 'g2',
            _type: 'request_group',
            parentId: 'g1',
            name: 'Users',
            headers: [{ name: 'B', value: '2' }],
          },
          req({ parentId: 'g2', headers: [{ name: 'C', value: '3' }] }),
        ],
      }),
    )!
    expect(out[0].spec.headers.map((h) => h.name)).toEqual(['A', 'B', 'C'])
  })

  test('an inherited header value is template-normalised like everything else', () => {
    expect(withFolder([{ name: 'X-Api-Key', value: '{{ _.key }}' }])[0].spec.headers[0].value).toBe(
      '{{key}}',
    )
  })

  test('a DISABLED folder header contributes nothing', () => {
    expect(withFolder([{ name: 'X-Api-Key', value: 'k', disabled: true }])[0].spec.headers).toEqual(
      [],
    )
  })
})

describe('inheritHeaders merges the way HTTP does, not the way an override would', () => {
  const h = (name: string, value: string, disabled?: boolean) => ({
    name,
    value,
    ...(disabled ? { disabled } : {}),
  })

  test('a SINGLE-VALUE header is REPLACED — two Content-Types is not a thing', () => {
    expect(
      inheritHeaders([[h('Content-Type', 'text/plain')]], [h('Content-Type', 'application/json')]),
    ).toEqual([{ name: 'Content-Type', value: 'application/json' }])
  })

  test.each([
    'content-type',
    'content-length',
    'host',
    'range',
    'proxy-authorization',
    'connection',
  ])('%s is single-value', (name) => {
    expect(inheritHeaders([[h(name, 'a')]], [h(name, 'b')])).toEqual([{ name, value: 'b' }])
  })

  test('any OTHER header accumulates, comma-joined — how HTTP spells a repeat on one line', () => {
    // Not fidelity for its own sake: our send path is a Record<string,string> and can carry one
    // value per name, so comma-joining is the only way a repeated Accept survives us at all.
    expect(inheritHeaders([[h('Accept', 'application/json')]], [h('Accept', 'text/csv')])).toEqual([
      { name: 'Accept', value: 'application/json, text/csv' },
    ])
  })

  test('matching is case-INSENSITIVE and the last writer sets the casing', () => {
    expect(inheritHeaders([[h('accept', 'a')]], [h('ACCEPT', 'b')])).toEqual([
      { name: 'ACCEPT', value: 'a, b' },
    ])
  })

  test.each([
    [
      [[h('X', 'v', true)]],
      'a disabled ANCESTOR header — it would not be sent, so it is not materialised',
    ],
    [[[h('', 'v')]], 'a blank name'],
    [[[h('   ', 'v')]], 'a whitespace name'],
    [[undefined], 'an absent list'],
    [[], 'no contexts'],
  ])('an ancestor context %j contributes nothing (%s)', (ancestors) => {
    expect(inheritHeaders(ancestors as never, [])).toEqual([])
  })

  test("the request's OWN disabled header is PRESERVED, not merged away", () => {
    // Import stores disabled headers as saved-but-off; `activePairs` drops them only at send time.
    expect(inheritHeaders([], [h('X-Debug', '1', true)])).toEqual([
      { name: 'X-Debug', value: '1', disabled: true },
    ])
  })

  test('an inherited header and a switched-off own header of the SAME name coexist', () => {
    // Send uses the enabled one (`activePairs`); the user still sees their own, still off.
    expect(
      inheritHeaders([[h('Accept', 'application/json')]], [h('Accept', 'text/csv', true)]),
    ).toEqual([
      { name: 'Accept', value: 'application/json' },
      { name: 'Accept', value: 'text/csv', disabled: true },
    ])
  })
})
