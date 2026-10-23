/**
 * Schema → example. Several of these pin a deliberate choice over a naive generator; each says
 * which, because the tempting simplification is to converge back onto the naive behaviour.
 */

import { describe, expect, test } from 'bun:test'
import { exampleFor, parameterValue } from './example'

const ex = (schema: unknown, document: unknown = {}) => exampleFor(document, schema as never)

describe('explicit values win', () => {
  test('an example is used verbatim', () => {
    expect(ex({ type: 'string', example: 'fido' })).toBe('fido')
  })

  test('a default is used when there is no example', () => {
    expect(ex({ type: 'integer', default: 42 })).toBe(42)
  })

  test.each([
    [{ type: 'integer', example: 0 }, 0],
    [{ type: 'boolean', example: false }, false],
    [{ type: 'string', example: '' }, ''],
    [{ type: 'integer', default: 0 }, 0],
    [{ type: 'boolean', default: false }, false],
  ])('a FALSY example/default is kept: %j → %j', (schema, expected) => {
    // Testing `if (schema.example)` would drop exactly the surprising values a person bothered to
    // document and replace them with a generic mock.
    expect(ex(schema)).toBe(expected)
  })
})

describe('type mocks', () => {
  test.each([
    [{ type: 'string' }, 'string'],
    [{ type: 'integer' }, 0],
    [{ type: 'number' }, 0],
    [{ type: 'boolean' }, true],
    [{ type: 'string', format: 'email' }, 'user@example.com'],
    [{ type: 'string', format: 'uuid' }, '00000000-0000-0000-0000-000000000000'],
  ])('%j → %j', (schema, expected) => {
    expect(ex(schema)).toEqual(expected)
  })

  test('date-time is DETERMINISTIC — the same spec imports byte-identically twice', () => {
    // Mocking this as `new Date().toISOString()` would make a re-import always differ from the
    // import and read like an edit.
    const a = ex({ type: 'string', format: 'date-time' })
    const b = ex({ type: 'string', format: 'date-time' })
    expect(a).toBe(b)
    expect(a).toBe('2020-01-01T00:00:00.000Z')
  })

  test('an unknown type yields undefined rather than a guess', () => {
    expect(ex({ type: 'wat' })).toBeUndefined()
    expect(ex({})).toBeUndefined()
  })
})

describe('composition', () => {
  test('an enum uses its first value — the only legal ones are listed', () => {
    expect(ex({ type: 'string', enum: ['available', 'pending'] })).toBe('available')
  })

  test('allOf merges every branch', () => {
    expect(
      ex({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } } },
          { type: 'object', properties: { b: { type: 'integer' } } },
        ],
      }),
    ).toEqual({ a: 'string', b: 0 })
  })

  test('oneOf takes the first branch', () => {
    expect(ex({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string')
  })

  test('anyOf takes the first branch', () => {
    expect(ex({ anyOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(0)
  })
})

describe('objects and arrays', () => {
  test('properties recurse', () => {
    expect(
      ex({
        type: 'object',
        properties: { pet: { type: 'object', properties: { name: { type: 'string' } } } },
      }),
    ).toEqual({ pet: { name: 'string' } })
  })

  test('an array wraps one example item', () => {
    expect(ex({ type: 'array', items: { type: 'string' } })).toEqual(['string'])
  })

  test('an array of nothing knowable is empty, not [undefined]', () => {
    expect(ex({ type: 'array' })).toEqual([])
  })
})

describe('readOnly is response-only', () => {
  test('a readOnly property is dropped from the body', () => {
    const out = ex({
      type: 'object',
      properties: { id: { type: 'string', readOnly: true }, name: { type: 'string' } },
    })
    expect(out).toEqual({ name: 'string' })
    // And it is genuinely absent, not present-and-undefined.
    expect(JSON.stringify(out)).toBe('{"name":"string"}')
  })
})

describe('cycles terminate', () => {
  const document = {
    components: {
      schemas: {
        Node: {
          type: 'object',
          properties: { name: { type: 'string' }, next: { $ref: '#/components/schemas/Node' } },
        },
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      },
    },
  }

  test('a self-reference stops at the repeat', () => {
    expect(ex({ $ref: '#/components/schemas/Node' }, document)).toEqual({ name: 'string' })
  })

  test('MUTUAL recursion terminates too', () => {
    expect(() => ex({ $ref: '#/components/schemas/A' }, document)).not.toThrow()
  })

  test('a deep nest is capped rather than followed forever', () => {
    // Build a 30-deep chain: past the cap the walk must stop, not stack-overflow.
    let schema: Record<string, unknown> = { type: 'string' }
    for (let i = 0; i < 30; i++) schema = { type: 'object', properties: { next: schema } }
    expect(() => ex(schema)).not.toThrow()
  })
})

describe('parameterValue', () => {
  test.each([
    [{ type: 'string', example: 'fido' }, 'fido'],
    [{ type: 'integer', example: 0 }, '0'],
    [{ type: 'boolean', example: false }, 'false'],
  ])('%j → %p', (schema, expected) => {
    expect(parameterValue({}, schema as never)).toBe(expected)
  })

  test('an explicit parameter example beats the schema’s', () => {
    expect(
      parameterValue({}, { type: 'string', example: 'from-schema' } as never, 'from-param'),
    ).toBe('from-param')
  })

  test('an object-valued parameter is shown as JSON, not exploded into a guessed style', () => {
    // OpenAPI has six serialization styles; picking one and being wrong makes a request that looks
    // right and isn't. JSON is visibly a value to edit.
    expect(
      parameterValue({}, { type: 'object', properties: { a: { type: 'string' } } } as never),
    ).toBe('{"a":"string"}')
  })

  test('nothing knowable is an empty string, not "undefined"', () => {
    expect(parameterValue({}, undefined)).toBe('')
    expect(parameterValue({}, {} as never)).toBe('')
  })
})
