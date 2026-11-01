import { describe, expect, test } from 'bun:test'
import { z } from 'zod'

import { strictToolSchema } from './strict-schema'

const jsonOf = (schema: z.ZodType): Record<string, unknown> => {
  const { $schema: _dialect, ...rest } = z.toJSONSchema(schema, { io: 'input' }) as Record<
    string,
    unknown
  >
  return rest
}

describe('strictToolSchema', () => {
  test('an optional field becomes required and nullable, and the object is closed', () => {
    const strict = strictToolSchema(
      jsonOf(z.object({ path: z.string(), limit: z.number().int().optional() })),
    )
    expect(strict).toMatchObject({
      type: 'object',
      properties: {
        path: { type: 'string' },
        limit: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
      },
      required: ['path', 'limit'],
      additionalProperties: false,
    })
  })

  test('nested objects, arrays and union branches get the same treatment', () => {
    const entry = z.object({ title: z.string(), link: z.string().nullable() })
    const strict = strictToolSchema(
      jsonOf(
        z.object({
          steps: z.array(
            z.discriminatedUnion('op', [
              z.object({ op: z.literal('rename'), title: z.string(), to: z.string().optional() }),
              z.object({ op: z.literal('add'), entry }),
            ]),
          ),
        }),
      ),
    ) as { properties: { steps: { items: { anyOf: Record<string, unknown>[] } } } }
    const [rename, add] = strict.properties.steps.items.anyOf as [
      { required: string[]; additionalProperties: boolean },
      { properties: { entry: { required: string[]; additionalProperties: boolean } } },
    ]
    expect(rename.required).toEqual(['op', 'title', 'to'])
    expect(rename.additionalProperties).toBe(false)
    expect(add.properties.entry.required).toEqual(['title', 'link'])
    expect(add.properties.entry.additionalProperties).toBe(false)
  })

  test('sends only keywords strict mode is known to take', () => {
    const strict = strictToolSchema(
      jsonOf(
        z.object({
          op: z.literal('rename').describe('The operation.'),
          name: z.string().min(1).max(40),
          tags: z.array(z.string()).min(1).max(5),
        }),
      ),
    ) as { properties: Record<string, Record<string, unknown>> }
    // A literal goes out as the one-member enum it means; unconfirmed bounds are left to the
    // tool's own validation instead of risking a refused request.
    expect(strict.properties.op).toEqual({
      type: 'string',
      description: 'The operation.',
      enum: ['rename'],
    })
    expect(strict.properties.name).toEqual({ type: 'string' })
    expect(strict.properties.tags).toEqual({ type: 'array', items: { type: 'string' } })
  })

  test('an optional field that also accepts null keeps the tool non-strict', () => {
    expect(
      strictToolSchema(jsonOf(z.object({ a: z.string().nullable().optional() }))),
    ).toBeUndefined()
  })

  test('what strict mode cannot express keeps the tool non-strict', () => {
    for (const schema of [
      z.object({ tags: z.record(z.string(), z.string()) }),
      z.object({ when: z.string().datetime() }),
      z.object({ id: z.string().default('x') }),
      z.object({ a: z.string().regex(/^x+$/) }),
    ])
      expect(strictToolSchema(jsonOf(schema))).toBeUndefined()
    expect(strictToolSchema({ type: 'object', properties: { a: { $ref: '#/$defs/x' } } })).toBe(
      undefined,
    )
    expect(strictToolSchema({ type: 'string' })).toBeUndefined()
  })

  test('the input is never modified', () => {
    const input = jsonOf(z.object({ a: z.string().optional() }))
    const before = structuredClone(input)
    strictToolSchema(input)
    expect(input).toEqual(before)
  })
})
