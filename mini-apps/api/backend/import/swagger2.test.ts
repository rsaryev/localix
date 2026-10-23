/**
 * Swagger 2.0, imported by translating it into OpenAPI 3.
 *
 * The claim under test is not "we parse 2.0" — it is that the TRANSLATION is faithful, because
 * everything after it is the OA3 importer's already-tested code. So these test the four things the
 * formats spell differently, and one end-to-end case to prove the seam holds.
 *
 * Verified against the reference's own seven swagger2 fixtures before any of this was written: the
 * real petstore gives 20 requests, 2 authed, 9 with bodies.
 */

import { describe, expect, test } from 'bun:test'
import {
  convertSwagger2,
  operationToOA3,
  parameterToOA3,
  serverUrlFrom,
  toOpenApi3,
} from './swagger2'

const doc = (over: Record<string, unknown> = {}) => ({
  swagger: '2.0',
  info: { title: 'Pets', version: '1' },
  host: 'api.dev',
  basePath: '/v2',
  schemes: ['https'],
  paths: {
    '/pets': { get: { operationId: 'listPets' } },
  },
  ...over,
})

describe('sniffing', () => {
  test('a 2.0 document is claimed', () => {
    expect(convertSwagger2(JSON.stringify(doc()))).toHaveLength(1)
  })

  test('YAML too — a great many specs are published that way', () => {
    expect(
      convertSwagger2(
        'swagger: "2.0"\nhost: api.dev\npaths:\n  /pets:\n    get:\n      operationId: listPets\n',
      ),
    ).toHaveLength(1)
  })

  test.each([
    [JSON.stringify({ openapi: '3.0.0', paths: {} }), 'OpenAPI 3 — that is the other importer'],
    [JSON.stringify({ swagger: '1.2', paths: {} }), 'Swagger 1.2 — not supported, and not claimed'],
    [JSON.stringify({ paths: {} }), 'no version marker'],
    ['curl https://api.dev', 'not a spec at all'],
    ['not json', 'not parseable'],
  ])('%p is not claimed (%s)', (text) => {
    expect(convertSwagger2(text)).toBeNull()
  })
})

describe('base url: schemes + host + basePath → one server', () => {
  test.each([
    [{ schemes: ['https'], host: 'api.dev', basePath: '/v2' }, 'https://api.dev/v2'],
    [{ schemes: ['http'], host: 'api.dev', basePath: '/v2' }, 'http://api.dev/v2'],
    [{ host: 'api.dev', basePath: '/v2' }, 'https://api.dev/v2'],
    [{ schemes: ['https'], host: 'api.dev' }, 'https://api.dev'],
  ])('%j → %p', (over, expected) => {
    expect(serverUrlFrom(over)).toBe(expected)
  })

  test('https WINS when both are offered — we resolve vault credentials at send time', () => {
    expect(serverUrlFrom({ schemes: ['http', 'https'], host: 'api.dev' })).toBe('https://api.dev')
  })

  test('a document with no host is RELATIVE, and lands on the answer OA3 already has', () => {
    // 2.0 says an absent host means "wherever this document was served from", which we cannot know.
    // An OA3 spec can declare a relative server too, so `baseUrlFrom` already reports it and asks
    // for `baseUrl` — no second message, no new concept.
    expect(serverUrlFrom({ basePath: '/api/v3' })).toBe('/api/v3')
  })

  test('an explicit baseUrl option is honoured through the seam', () => {
    const out = convertSwagger2(JSON.stringify(doc({ host: undefined })), {
      baseUrl: 'https://staging.dev',
    })
    expect(out?.[0].spec.url).toBe('https://staging.dev/v2/pets')
  })
})

describe('a 2.0 parameter carries type/format directly; a 3.0 one wraps them in schema', () => {
  test('the lift happens — without it every generated example is silently empty', () => {
    expect(
      parameterToOA3({ name: 'id', in: 'path', required: true, type: 'string', format: 'uuid' }),
    ).toEqual({
      name: 'id',
      in: 'path',
      required: true,
      schema: { type: 'string', format: 'uuid' },
    })
  })

  test('enum, items and default come along', () => {
    expect(
      parameterToOA3({
        name: 'x',
        in: 'query',
        type: 'array',
        items: { type: 'string' },
        enum: ['a'],
        default: 'a',
      }),
    ).toEqual({
      name: 'x',
      in: 'query',
      schema: { type: 'array', items: { type: 'string' }, enum: ['a'], default: 'a' },
    })
  })

  test('a parameter that ALREADY has a schema is left alone', () => {
    expect(
      parameterToOA3({ name: 'b', in: 'body', schema: { $ref: '#/definitions/Pet' } }),
    ).toEqual({
      name: 'b',
      in: 'body',
      schema: { $ref: '#/definitions/Pet' },
    })
  })
})

describe('a body lives in `parameters` in 2.0 and in `requestBody` in 3.0', () => {
  test('an in:body parameter is LIFTED OUT — left in place our bucketer reads it as a header', () => {
    const out = operationToOA3(
      {
        parameters: [
          { name: 'pet', in: 'body', required: true, schema: { type: 'object' } },
          { name: 'k', in: 'header' },
        ],
      },
      undefined,
    )
    expect(out.requestBody).toEqual({
      required: true,
      content: { 'application/json': { schema: { type: 'object' } } },
    })
    // …and only the header survives in `parameters`.
    expect((out.parameters as unknown[]).map((p) => (p as { name: string }).name)).toEqual(['k'])
  })

  test("the operation's own `consumes` decides the mime", () => {
    const out = operationToOA3(
      { consumes: ['application/xml'], parameters: [{ name: 'b', in: 'body', schema: {} }] },
      ['application/json'],
    )
    expect(Object.keys((out.requestBody as { content: object }).content)).toEqual([
      'application/xml',
    ])
  })

  test("the document's `consumes` is the fallback", () => {
    const out = operationToOA3({ parameters: [{ name: 'b', in: 'body', schema: {} }] }, [
      'application/xml',
    ])
    expect(Object.keys((out.requestBody as { content: object }).content)).toEqual([
      'application/xml',
    ])
  })

  test('formData fields become a form body', () => {
    const out = operationToOA3(
      {
        parameters: [
          { name: 'a', in: 'formData', type: 'string', required: true },
          { name: 'b', in: 'formData', type: 'integer' },
        ],
      },
      undefined,
    )
    const { content } = out.requestBody as {
      content: Record<string, { schema: { properties: object; required: string[] } }>
    }
    expect(Object.keys(content)).toEqual(['application/x-www-form-urlencoded'])
    expect(content['application/x-www-form-urlencoded'].schema.properties).toEqual({
      a: { type: 'string' },
      b: { type: 'integer' },
    })
    expect(content['application/x-www-form-urlencoded'].schema.required).toEqual(['a'])
  })

  test('a `type: file` field forces MULTIPART, whatever `consumes` claims', () => {
    // It is the only way to carry a file. A spec that forgets to declare it is still describing
    // multipart, and urlencoding a file is not a thing.
    const out = operationToOA3(
      {
        consumes: ['application/x-www-form-urlencoded'],
        parameters: [{ name: 'f', in: 'formData', type: 'file' }],
      },
      undefined,
    )
    expect(Object.keys((out.requestBody as { content: object }).content)).toEqual([
      'multipart/form-data',
    ])
  })

  test('an operation with no body gets no requestBody', () => {
    expect(
      operationToOA3({ parameters: [{ name: 'k', in: 'query' }] }, undefined).requestBody,
    ).toBeUndefined()
  })
})

describe('`securityDefinitions` → `components.securitySchemes`', () => {
  test('a scheme is moved where the OA3 importer looks for it', () => {
    const oa3 = toOpenApi3(
      doc({ securityDefinitions: { api_key: { type: 'apiKey', name: 'X-Key', in: 'header' } } }),
    )
    expect(oa3.components?.securitySchemes).toEqual({
      api_key: { type: 'apiKey', name: 'X-Key', in: 'header' },
    })
  })

  test('an operation is actually signed with it, end to end', () => {
    const out = convertSwagger2(
      JSON.stringify(
        doc({
          securityDefinitions: { api_key: { type: 'apiKey', name: 'X-Key', in: 'header' } },
          paths: { '/pets': { get: { operationId: 'listPets', security: [{ api_key: [] }] } } },
        }),
      ),
    )
    expect(out?.[0].spec.auth).toMatchObject({ type: 'apikey', key: 'X-Key', addTo: 'header' })
  })
})

describe('`definitions` and `$ref: #/definitions/X`', () => {
  test('both spellings are kept, because a $ref is resolved by walking the pointer LITERALLY', () => {
    const oa3 = toOpenApi3(doc({ definitions: { Pet: { type: 'object' } } }))
    expect(oa3.components?.schemas).toEqual({ Pet: { type: 'object' } })
    expect((oa3 as unknown as { definitions: object }).definitions).toEqual({
      Pet: { type: 'object' },
    })
  })

  test('a $ref into definitions resolves into a real body — the reference fixtures rely on this', () => {
    const out = convertSwagger2(
      JSON.stringify(
        doc({
          definitions: {
            Pet: { type: 'object', properties: { name: { type: 'string', example: 'Rex' } } },
          },
          paths: {
            '/pets': {
              post: {
                operationId: 'createPet',
                parameters: [
                  {
                    name: 'pet',
                    in: 'body',
                    required: true,
                    schema: { $ref: '#/definitions/Pet' },
                  },
                ],
              },
            },
          },
        }),
      ),
    )
    expect(out?.[0].spec.body?.text).toContain('Rex')
  })
})

describe('the translated document is an OA3 one', () => {
  test('it declares openapi 3.0.0 and drops the 2.0-only keys', () => {
    const oa3 = toOpenApi3(doc()) as unknown as Record<string, unknown>
    expect(oa3.openapi).toBe('3.0.0')
    expect(oa3.servers).toEqual([{ url: 'https://api.dev/v2' }])
    expect(oa3.swagger).toBeUndefined()
    expect(oa3.host).toBeUndefined()
    expect(oa3.basePath).toBeUndefined()
    expect(oa3.schemes).toBeUndefined()
  })

  test('a path-level `parameters` list is lifted too — it is shared by every operation under it', () => {
    const out = convertSwagger2(
      JSON.stringify(
        doc({
          paths: {
            '/pets/{id}': {
              parameters: [{ name: 'id', in: 'path', required: true, type: 'string' }],
              get: { operationId: 'getPet' },
            },
          },
        }),
      ),
    )
    expect(out?.[0].spec.url).toBe('https://api.dev/v2/pets/:id')
    expect(out?.[0].spec.pathParameters).toHaveLength(1)
  })
})

describe('malformed documents do not throw', () => {
  test.each([
    JSON.stringify({ swagger: '2.0' }),
    JSON.stringify({ swagger: '2.0', paths: null }),
    JSON.stringify({ swagger: '2.0', paths: { '/x': null } }),
    JSON.stringify({ swagger: '2.0', paths: { '/x': { get: 'nope' } } }),
    JSON.stringify({ swagger: '2.0', paths: { '/x': { get: { parameters: 'nope' } } } }),
  ])('%p', (text) => {
    expect(() => convertSwagger2(text)).not.toThrow()
  })
})
