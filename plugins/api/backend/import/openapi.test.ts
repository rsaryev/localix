/**
 * The OpenAPI 3 importer.
 *
 * A number of these tests pin cases a naive importer gets WRONG. Each such case says so, because the
 * tempting "simplification" is to converge back onto the naive behaviour, and the test is the only
 * thing that would notice.
 */

import { describe, expect, test } from 'bun:test'
import { convertOpenApi, openApiImporter, operationName, pathToPlaceholders } from './openapi'

const doc = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    openapi: '3.0.0',
    info: { title: 'Petstore' },
    servers: [{ url: 'https://api.petstore.dev/v1' }],
    paths: {},
    ...over,
  })

const one = (over: Record<string, unknown>) => {
  const out = convertOpenApi(doc(over))
  expect(out).not.toBeNull()
  return out!
}

describe('sniffing', () => {
  test('a 3.0.0 spec is claimed', () => {
    expect(convertOpenApi(doc())).toEqual([])
  })

  test.each(['3.0.0', '3.0.3', '3.1.0', '3.1', '3.0'])('openapi: %p is accepted', (version) => {
    // A gate of /^3\.\d+\.\d+$/ would reject "3.1" and "3.0" — both legal and common.
    const out = convertOpenApi(doc({ openapi: version, paths: { '/x': { get: {} } } }))
    expect(out).toHaveLength(1)
  })

  test.each(['2.0', '4.0.0'])('openapi: %p is NOT ours', (version) => {
    expect(convertOpenApi(doc({ openapi: version }))).toBeNull()
  })

  test('a swagger 2 doc is declined — it has no `openapi` key', () => {
    expect(convertOpenApi(JSON.stringify({ swagger: '2.0', paths: {} }))).toBeNull()
  })

  test.each(['curl https://api.dev', 'not a spec at all', '', '{"log":{"entries":[]}}'])(
    '%p is not a spec',
    (text) => {
      expect(convertOpenApi(text)).toBeNull()
    },
  )

  test('a YAML spec is claimed too', () => {
    const yaml = `
openapi: 3.0.0
info:
  title: Petstore
servers:
  - url: https://api.petstore.dev/v1
paths:
  /pets:
    get:
      operationId: listPets
`
    const out = convertOpenApi(yaml)
    expect(out).toHaveLength(1)
    expect(out![0].name).toBe('listpets')
    expect(out![0].spec.url).toBe('https://api.petstore.dev/v1/pets')
  })
})

describe('operations', () => {
  test('every method under a path becomes a request', () => {
    const out = one({ paths: { '/pets': { get: {}, post: {}, delete: {} } } })
    expect(out.map((r) => r.spec.method).sort()).toEqual(['DELETE', 'GET', 'POST'])
  })

  test('non-operation members of a path item are not requests', () => {
    const out = one({
      paths: {
        '/pets': {
          get: {},
          summary: 'Pets',
          description: 'things',
          servers: [{ url: 'https://other.dev' }],
          parameters: [{ name: 'x', in: 'query' }],
          'x-internal': { get: {} },
        },
      },
    })
    expect(out).toHaveLength(1)
  })

  test('the url is the base server plus the path', () => {
    const out = one({ paths: { '/pets': { get: {} } } })
    expect(out[0].spec.url).toBe('https://api.petstore.dev/v1/pets')
  })
})

describe('naming', () => {
  test('operationId wins — it is the spec’s OWN unique id', () => {
    const out = one({
      paths: { '/pets': { get: { operationId: 'listPets', summary: 'List pets' } } },
    })
    expect(out[0].name).toBe('listpets')
  })

  test('summary is the fallback', () => {
    const out = one({ paths: { '/pets': { get: { summary: 'List all pets' } } } })
    expect(out[0].name).toBe('list-all-pets')
  })

  test('method + path is the last resort', () => {
    expect(operationName('/pets', 'get', {})).toBe('get-pets')
  })
})

describe('path parameters — the reference drops these entirely', () => {
  test('{id} becomes our :id placeholder', () => {
    expect(pathToPlaceholders('/pets/{petId}/toys/{toyId}')).toBe('/pets/:petId/toys/:toyId')
  })

  test('a path parameter is EMITTED, not just rewritten into the url', () => {
    const out = one({
      paths: {
        '/pets/{petId}': {
          get: {
            parameters: [
              {
                name: 'petId',
                in: 'path',
                required: true,
                schema: { type: 'string', example: 'fido' },
              },
            ],
          },
        },
      },
    })
    expect(out[0].spec.url).toBe('https://api.petstore.dev/v1/pets/:petId')
    expect(out[0].spec.pathParameters).toEqual([{ name: 'petId', value: 'fido' }])
  })

  test('a path-level parameter is inherited by its operations', () => {
    // Without merging path-level parameters, a spec that hoists a shared `:id` — the idiomatic
    // place for it — imports with the parameter missing from every request.
    const out = one({
      paths: {
        '/pets/{petId}': {
          parameters: [{ name: 'petId', in: 'path', required: true, schema: { type: 'string' } }],
          get: {},
          delete: {},
        },
      },
    })
    expect(out).toHaveLength(2)
    for (const r of out) expect(r.spec.pathParameters).toEqual([{ name: 'petId', value: 'string' }])
  })

  test('an operation parameter overrides the path-level one of the same name+in', () => {
    const out = one({
      paths: {
        '/pets/{petId}': {
          parameters: [{ name: 'petId', in: 'path', schema: { example: 'inherited' } }],
          get: { parameters: [{ name: 'petId', in: 'path', schema: { example: 'own' } }] },
        },
      },
    })
    expect(out[0].spec.pathParameters).toEqual([{ name: 'petId', value: 'own' }])
  })
})

describe('query and header parameters', () => {
  test('a REQUIRED parameter is enabled; an optional one imports switched off', () => {
    const out = one({
      paths: {
        '/pets': {
          get: {
            parameters: [
              { name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
              { name: 'tag', in: 'query', schema: { type: 'string' } },
            ],
          },
        },
      },
    })
    expect(out[0].spec.query).toEqual([
      { name: 'limit', value: '0' },
      { name: 'tag', value: 'string', disabled: true },
    ])
  })

  test('header parameters land in headers', () => {
    const out = one({
      paths: {
        '/pets': {
          get: {
            parameters: [
              { name: 'X-Trace', in: 'header', required: true, schema: { type: 'string' } },
            ],
          },
        },
      },
    })
    expect(out[0].spec.headers).toEqual([{ name: 'X-Trace', value: 'string' }])
  })

  test('a cookie parameter is skipped rather than half-imported', () => {
    const out = one({
      paths: { '/pets': { get: { parameters: [{ name: 'sid', in: 'cookie', schema: {} }] } } },
    })
    expect(out[0].spec.headers).toEqual([])
    expect(out[0].spec.query).toEqual([])
  })
})

describe('request body', () => {
  test('a JSON schema becomes an example body', () => {
    const out = one({
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' }, age: { type: 'integer' } },
                  },
                },
              },
            },
          },
        },
      },
    })
    expect(out[0].spec.body?.mimeType).toBe('application/json')
    expect(JSON.parse(out[0].spec.body!.text!)).toEqual({ name: 'string', age: 0 })
  })

  test('JSON is PREFERRED over an earlier */* key', () => {
    // Taking the first key that substring-matches would let a `*/*` declared first win and
    // produce no example — the ordering of a YAML map would decide the import.
    const out = one({
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: {
                '*/*': {},
                'application/json': {
                  schema: { type: 'object', properties: { a: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    })
    expect(out[0].spec.body?.mimeType).toBe('application/json')
    expect(out[0].spec.body?.text).toContain('"a"')
  })

  test('a form body becomes form pairs', () => {
    const out = one({
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: {
                'application/x-www-form-urlencoded': {
                  schema: { type: 'object', properties: { name: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    })
    expect(out[0].spec.body?.form).toEqual([{ name: 'name', value: 'string' }])
  })

  test('a type we cannot illustrate still carries its content type', () => {
    const out = one({
      paths: {
        '/upload': { post: { requestBody: { content: { 'application/octet-stream': {} } } } },
      },
    })
    expect(out[0].spec.body).toEqual({ mimeType: 'application/octet-stream' })
  })

  test('a GET with no requestBody has no body', () => {
    expect(one({ paths: { '/pets': { get: {} } } })[0].spec.body).toBeUndefined()
  })
})

describe('$ref', () => {
  test('a component schema resolves', () => {
    const out = one({
      components: {
        schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
      },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
          },
        },
      },
    })
    expect(JSON.parse(out[0].spec.body!.text!)).toEqual({ name: 'string' })
  })

  test('a component parameter resolves', () => {
    const out = one({
      components: {
        parameters: {
          Limit: { name: 'limit', in: 'query', required: true, schema: { type: 'integer' } },
        },
      },
      paths: { '/pets': { get: { parameters: [{ $ref: '#/components/parameters/Limit' }] } } },
    })
    expect(out[0].spec.query).toEqual([{ name: 'limit', value: '0' }])
  })

  test('a SELF-REFERENCING schema terminates', () => {
    // We resolve refs ourselves, so without a cycle guard this would recurse forever.
    const out = one({
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { name: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
      paths: {
        '/n': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
            },
          },
        },
      },
    })
    expect(JSON.parse(out[0].spec.body!.text!)).toEqual({ name: 'string' })
  })

  test('an unresolvable ref degrades rather than throwing', () => {
    const out = one({
      paths: {
        '/x': {
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: '#/nope' } } } },
          },
        },
      },
    })
    expect(out).toHaveLength(1)
  })

  test('an EXTERNAL ref is not fetched', () => {
    const out = one({
      paths: {
        '/x': {
          post: {
            requestBody: {
              content: { 'application/json': { schema: { $ref: 'https://evil.dev/s.json' } } },
            },
          },
        },
      },
    })
    expect(out[0].spec.body?.text).toBe('')
  })
})

describe('security → vault-referencing auth', () => {
  const withSecurity = (schemes: Record<string, unknown>, security: unknown[]) =>
    one({
      components: { securitySchemes: schemes },
      security,
      paths: { '/pets': { get: {} } },
    })

  test('http bearer becomes a bearer auth REFERENCING the vault', () => {
    const out = withSecurity({ bearerAuth: { type: 'http', scheme: 'bearer' } }, [
      { bearerAuth: [] },
    ])
    expect(out[0].spec.auth).toEqual({
      type: 'bearer',
      token: '${secret:REST_PETSTORE_BEARERAUTH}',
    })
  })

  test('http basic references the vault for the password only', () => {
    const out = withSecurity({ basicAuth: { type: 'http', scheme: 'basic' } }, [{ basicAuth: [] }])
    expect(out[0].spec.auth).toEqual({
      type: 'basic',
      username: '',
      password: '${secret:REST_PETSTORE_BASICAUTH}',
    })
  })

  test('an apiKey keeps its header name and references the vault for the value', () => {
    const out = withSecurity({ key: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } }, [
      { key: [] },
    ])
    expect(out[0].spec.auth).toEqual({
      type: 'apikey',
      key: 'X-Api-Key',
      value: '${secret:REST_PETSTORE_KEY}',
      addTo: 'header',
    })
  })

  test('an apiKey in the query lands in the query', () => {
    const out = withSecurity({ key: { type: 'apiKey', name: 'api_key', in: 'query' } }, [
      { key: [] },
    ])
    expect((out[0].spec.auth as { addTo: string }).addTo).toBe('query')
  })

  test('oauth2 is NOT faked as another auth type', () => {
    // A request claiming an auth it cannot perform wastes a debugging session; one that says it is
    // unauthenticated is a to-do.
    const out = withSecurity({ oauth: { type: 'oauth2', flows: {} } }, [{ oauth: [] }])
    expect(out[0].spec.auth).toEqual({ type: 'none' })
  })

  test('no security means no auth', () => {
    expect(one({ paths: { '/pets': { get: {} } } })[0].spec.auth).toEqual({ type: 'none' })
  })

  test('operation security REPLACES the document’s', () => {
    const out = one({
      components: {
        securitySchemes: {
          a: { type: 'http', scheme: 'bearer' },
          b: { type: 'apiKey', name: 'X-B', in: 'header' },
        },
      },
      security: [{ a: [] }],
      paths: { '/pets': { get: { security: [{ b: [] }] } } },
    })
    expect(out[0].spec.auth).toMatchObject({ type: 'apikey', key: 'X-B' })
  })

  test('`security: []` on an operation means PUBLIC, overriding the document', () => {
    // The spec's own rule. An `||` check here would read the empty array as "no override".
    const out = one({
      components: { securitySchemes: { a: { type: 'http', scheme: 'bearer' } } },
      security: [{ a: [] }],
      paths: { '/pets': { get: { security: [] } } },
    })
    expect(out[0].spec.auth).toEqual({ type: 'none' })
  })
})

describe('servers', () => {
  test('a server variable is filled from its default', () => {
    const out = one({
      servers: [
        {
          url: 'https://{host}/v{version}',
          variables: { host: { default: 'api.dev' }, version: { default: '2' } },
        },
      ],
      paths: { '/x': { get: {} } },
    })
    expect(out[0].spec.url).toBe('https://api.dev/v2/x')
  })

  test('a variable with only an enum uses its first value', () => {
    const out = one({
      servers: [
        { url: 'https://{env}.api.dev', variables: { env: { enum: ['prod', 'staging'] } } },
      ],
      paths: { '/x': { get: {} } },
    })
    expect(out[0].spec.url).toBe('https://prod.api.dev/x')
  })

  test('a variable with NO default leaves the placeholder rather than losing the import', () => {
    // Throwing here would discard every other endpoint in the document.
    const out = one({
      servers: [{ url: 'https://{host}/v1', variables: { host: {} } }],
      paths: { '/x': { get: {} } },
    })
    expect(out).toHaveLength(1)
    expect(out[0].spec.url).toContain('{host}')
  })

  test('the first server wins', () => {
    const out = one({
      servers: [{ url: 'https://a.dev' }, { url: 'https://b.dev' }],
      paths: { '/x': { get: {} } },
    })
    expect(out[0].spec.url).toBe('https://a.dev/x')
  })

  test('no servers falls back to a placeholder host, keeping the paths', () => {
    const out = convertOpenApi(
      JSON.stringify({ openapi: '3.0.0', info: { title: 'X' }, paths: { '/x': { get: {} } } }),
    )!
    expect(out[0].spec.url).toBe('https://example.com/x')
  })

  test('a trailing slash on the server does not double up', () => {
    const out = one({ servers: [{ url: 'https://a.dev/v1/' }], paths: { '/x': { get: {} } } })
    expect(out[0].spec.url).toBe('https://a.dev/v1/x')
  })
})

describe('an auth we cannot sign is REPORTED, not silently dropped', () => {
  // The gap: `security.ts` computed `unsupported` precisely so an import "does not silently drop
  // it" — and `convertOpenApi` threw the value away. A spec secured only by oauth2 imported every
  // endpoint as `auth: none` and said nothing. Found by auditing which claims had no test.
  const oauthSpec = () =>
    doc({
      components: {
        securitySchemes: { oauth: { type: 'oauth2', flows: { implicit: { scopes: {} } } } },
      },
      security: [{ oauth: [] }],
      paths: { '/pets': { get: {} } },
    })

  test('the requests import unauthenticated', () => {
    expect(convertOpenApi(oauthSpec())![0].spec.auth).toEqual({ type: 'none' })
  })

  test('…and the importer SAYS so, naming the scheme', () => {
    const notes = openApiImporter.notes!(oauthSpec())
    expect(notes.join(' ')).toContain('oauth2')
    expect(notes.join(' ')).toContain('UNAUTHENTICATED')
  })

  test('a spec we CAN sign reports nothing', () => {
    const supported = doc({
      components: { securitySchemes: { b: { type: 'http', scheme: 'bearer' } } },
      security: [{ b: [] }],
      paths: { '/pets': { get: {} } },
    })
    expect(openApiImporter.notes!(supported)).toEqual([])
  })

  test('a spec with no security at all reports nothing', () => {
    expect(openApiImporter.notes!(doc({ paths: { '/pets': { get: {} } } }))).toEqual([])
  })
})
