import { describe, expect, it } from 'bun:test'
import { z } from 'zod'
import { zodToJsonSchema } from './zod-schema'

describe('zodToJsonSchema', () => {
  it('converts a Zod object to a JSON schema and strips $schema', () => {
    const schema = z.object({ name: z.string(), count: z.number() })
    const out = zodToJsonSchema(schema)
    expect(out.type).toBe('object')
    expect((out.properties as Record<string, unknown>)?.name).toBeDefined()
    expect(out.$schema).toBeUndefined() // stripped so it never leaks into the wire tool def
  })

  it('memoizes per schema instance (returns the same object reference)', () => {
    const schema = z.object({ a: z.string() })
    expect(zodToJsonSchema(schema)).toBe(zodToJsonSchema(schema))
  })

  it('produces distinct results for distinct schemas', () => {
    const a = zodToJsonSchema(z.object({ x: z.string() }))
    const b = zodToJsonSchema(z.object({ y: z.number() }))
    expect(a).not.toBe(b)
    expect((a.properties as Record<string, unknown>).x).toBeDefined()
    expect((b.properties as Record<string, unknown>).y).toBeDefined()
  })

  it('strips Zod v4 auto-emitted safe-integer bounds (noise) but keeps real bounds', () => {
    const out = zodToJsonSchema(
      z.object({
        offset: z.number().int().min(0), // min(0) real, max auto safe-int (noise)
        idx: z.number().int(), // both bounds auto safe-int (noise)
        timeout: z.number().int().min(1).max(600), // both real
      }),
    )
    const props = out.properties as Record<string, Record<string, unknown>>
    expect(props.offset.minimum).toBe(0) // real bound kept
    expect(props.offset.maximum).toBeUndefined() // safe-int noise stripped
    expect(props.idx.maximum).toBeUndefined()
    expect(props.idx.minimum).toBeUndefined()
    expect(props.timeout.minimum).toBe(1) // real bounds kept
    expect(props.timeout.maximum).toBe(600)
    expect(JSON.stringify(out)).not.toContain('9007199254740991')
  })

  it('states type:"object" at the root of a discriminated union (OpenAI refuses a bare oneOf)', () => {
    // Live via OpenRouter: "Invalid schema for function 'vault': schema must be a JSON Schema of
    // 'type: "object"', got 'type: "None"'" — the vault tool's root is a discriminatedUnion.
    const out = zodToJsonSchema(
      z.discriminatedUnion('action', [
        z.object({ action: z.literal('list') }),
        z.object({ action: z.literal('get'), key: z.string() }),
      ]),
    )
    expect(out.type).toBe('object')
    expect(Array.isArray(out.oneOf ?? out.anyOf)).toBe(true)
    // A union of non-objects is left alone: that is a genuinely invalid tool schema to surface.
    const scalar = zodToJsonSchema(z.union([z.string(), z.number()]))
    expect(scalar.type).toBeUndefined()
  })

  it('falls back to {type:"object"} when the schema exposes no toJSONSchema', () => {
    expect(zodToJsonSchema({})).toEqual({ type: 'object' })
  })

  it('falls back to {type:"object"} when toJSONSchema throws', () => {
    const bad = {
      toJSONSchema: () => {
        throw new Error('boom')
      },
    }
    expect(zodToJsonSchema(bad as never)).toEqual({ type: 'object' })
  })
})
