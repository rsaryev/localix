import { describe, expect, test } from 'bun:test'

import { prepareModelToolSchema } from './model-tool-schema'

describe('prepareModelToolSchema', () => {
  test('snapshot: removes unreachable definitions but preserves transitive refs without degrading', () => {
    const prepared = prepareModelToolSchema({
      type: 'object',
      properties: { value: { $ref: '#/$defs/A' } },
      $defs: {
        A: { type: 'object', properties: { child: { $ref: '#/$defs/B' } } },
        B: { type: 'string' },
        dead: { type: 'number', description: 'never referenced' },
      },
    })

    expect(JSON.stringify(prepared.schema, null, 2)).toBe(`{
  "type": "object",
  "properties": {
    "value": {
      "$ref": "#/$defs/A"
    }
  },
  "$defs": {
    "A": {
      "type": "object",
      "properties": {
        "child": {
          "$ref": "#/$defs/B"
        }
      }
    },
    "B": {
      "type": "string"
    }
  }
}`)
    expect(prepared.diagnostic).toBeUndefined()
  })

  test('counts UTF-8 bytes and strips descriptions only after the budget is exceeded', () => {
    const descriptions = 'é'.repeat(400)
    const prepared = prepareModelToolSchema(
      {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 8 }, (_, index) => [
            `field_${index}`,
            { type: 'string', description: descriptions },
          ]),
        ),
      },
      { budgetBytes: 600 },
    )

    expect(prepared.bytes).toBeLessThanOrEqual(600)
    expect(prepared.diagnostic?.reason).toBe('over_byte_budget')
    expect(prepared.diagnostic?.stages).toEqual(['descriptions'])
    expect(prepared.diagnostic!.originalBytes).toBeGreaterThan(descriptions.length * 8)
    expect(JSON.stringify(prepared.schema)).not.toContain('description')
  })

  test('degrades depth before compositions and remains within the hard byte cap', () => {
    const variants = Array.from({ length: 80 }, (_, index) => ({
      type: 'object',
      properties: { [`variant_${index}`]: { type: 'string' } },
    }))
    const prepared = prepareModelToolSchema(
      { type: 'object', properties: { value: { oneOf: variants } } },
      { budgetBytes: 100 },
    )

    expect(prepared.bytes).toBeLessThanOrEqual(100)
    expect(prepared.diagnostic?.stages).toEqual(['descriptions', 'depth', 'compositions'])
  })

  test('falls back to a minimal safe object when property names alone exceed the budget', () => {
    const prepared = prepareModelToolSchema(
      {
        type: 'object',
        properties: Object.fromEntries(
          Array.from({ length: 100 }, (_, index) => [`very_long_property_name_${index}`, {}]),
        ),
      },
      { budgetBytes: 64 },
    )

    expect(prepared.schema).toEqual({ type: 'object' })
    expect(prepared.bytes).toBeLessThanOrEqual(64)
    expect(prepared.diagnostic?.stages).toEqual([
      'descriptions',
      'depth',
      'compositions',
      'fallback',
    ])
  })

  test('rejects impossible or non-integral budgets', () => {
    expect(() => prepareModelToolSchema({}, { budgetBytes: 63 })).toThrow(RangeError)
    expect(() => prepareModelToolSchema({}, { budgetBytes: 64.5 })).toThrow(RangeError)
  })
})
