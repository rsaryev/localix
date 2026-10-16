import { describe, expect, test as it } from 'bun:test'

import { mcpInputSchema } from './mcp-schema'
import { zodToJsonSchema } from '../utils/zod-schema'

describe('mcpInputSchema bridge', () => {
  const raw = {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' },
      depth: { type: 'number' },
    },
    required: ['path'],
  }

  it('round-trips the schema through zodToJsonSchema()', () => {
    const schema = mcpInputSchema(raw)
    const json = zodToJsonSchema(schema as never)
    expect(json.type).toBe('object')
    expect(json.properties).toMatchObject({
      path: { type: 'string', description: 'File path' },
      depth: { type: 'number' },
    })
    expect(json.required).toEqual(['path'])
    // Normalized to a strict object so the provider never sees surprise keys.
    expect(json.additionalProperties).toBe(false)
  })

  it('normalizes a missing/loose schema to a strict object', () => {
    const json = zodToJsonSchema(mcpInputSchema(undefined) as never)
    expect(json).toMatchObject({ type: 'object', properties: {}, additionalProperties: false })
  })

  it('safeParse accepts an object payload and passes args through', () => {
    const result = (
      mcpInputSchema(raw) as unknown as {
        safeParse(v: unknown): { success: boolean; data?: unknown }
      }
    ).safeParse({ path: '/tmp/x', depth: 2 })
    expect(result.success).toBe(true)
    expect(result.data).toEqual({ path: '/tmp/x', depth: 2 })
  })

  it('safeParse treats null/undefined as empty args', () => {
    const schema = mcpInputSchema(raw) as unknown as {
      safeParse(v: unknown): { success: boolean; data?: unknown }
    }
    const optional = mcpInputSchema({ type: 'object', properties: {} }) as unknown as typeof schema
    expect(optional.safeParse(undefined)).toEqual({ success: true, data: {} })
    expect(optional.safeParse(null)).toEqual({ success: true, data: {} })
    // …and empty args still have to satisfy the server's required fields.
    expect(schema.safeParse(undefined).success).toBe(false)
  })

  it('safeParse validates arguments against the server schema, keeping extra keys', () => {
    const schema = mcpInputSchema(raw) as unknown as {
      safeParse(v: unknown): {
        success: boolean
        data?: unknown
        error?: { issues: Array<{ path: PropertyKey[] }> }
      }
    }
    const wrongType = schema.safeParse({ path: '/tmp/x', depth: 'deep' })
    expect(wrongType.success).toBe(false)
    expect(wrongType.error?.issues[0]?.path).toEqual(['depth'])
    expect(schema.safeParse({ depth: 1 }).success).toBe(false)
    expect(schema.safeParse({ path: '/x', extra: true })).toEqual({
      success: true,
      data: { path: '/x', extra: true },
    })
  })

  it('a schema zod cannot read degrades to the object-shape check', () => {
    const schema = mcpInputSchema({
      type: 'object',
      properties: { r: { $ref: '#/definitions/Missing' } },
    }) as unknown as { safeParse(v: unknown): { success: boolean } }
    expect(schema.safeParse({ r: 1 }).success).toBe(true)
    expect(schema.safeParse('x').success).toBe(false)
  })

  it('safeParse rejects non-object payloads with issues', () => {
    const schema = mcpInputSchema(raw) as unknown as {
      safeParse(v: unknown): { success: boolean; error?: { issues: unknown[] } }
    }
    const result = schema.safeParse('not-an-object')
    expect(result.success).toBe(false)
    expect(result.error?.issues).toHaveLength(1)
  })
})
