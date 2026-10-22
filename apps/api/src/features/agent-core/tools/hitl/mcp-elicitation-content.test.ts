import { describe, expect, test } from 'bun:test'

import type { McpElicitationSchema } from './mcp-elicitation'
import { elicitationOptions, validateElicitationContent } from './mcp-elicitation-content'

const schema: McpElicitationSchema = {
  type: 'object',
  properties: {
    email: { type: 'string', format: 'email' },
    name: { type: 'string', minLength: 2, maxLength: 5 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    ratio: { type: 'number' },
    agree: { type: 'boolean' },
    size: { type: 'string', oneOf: [{ const: 's', title: 'Small' }] },
    legacy: { type: 'string', enum: ['a', 'b'], enumNames: ['Alpha', 'Beta'] },
    tags: { type: 'array', items: { type: 'string', enum: ['x', 'y'] }, maxItems: 1 },
    when: { type: 'string', format: 'date' },
  },
  required: ['email'],
}

describe('validateElicitationContent', () => {
  test('keeps only the fields the form names, when every one fits', () => {
    const check = validateElicitationContent(schema, {
      email: 'a@b.co',
      age: 30,
      ratio: 0.5,
      agree: true,
      size: 's',
      legacy: 'b',
      tags: ['x'],
      when: '2026-10-22',
      extra: 'dropped',
    })
    expect(check).toEqual({
      ok: true,
      content: {
        email: 'a@b.co',
        age: 30,
        ratio: 0.5,
        agree: true,
        size: 's',
        legacy: 'b',
        tags: ['x'],
        when: '2026-10-22',
      },
    })
  })

  test('names every field that does not fit', () => {
    const check = validateElicitationContent(schema, {
      name: 'n',
      age: 1.5,
      agree: 'yes',
      size: 'xl',
      tags: ['x', 'y'],
      when: '22/10/2026',
    })
    expect(check.ok).toBe(false)
    if (check.ok) return
    expect(Object.keys(check.errors).sort()).toEqual(
      ['email', 'name', 'age', 'agree', 'size', 'tags', 'when'].sort(),
    )
    expect(check.errors.email).toBe('Required')
  })

  test('a non-object answer is no answer', () => {
    expect(validateElicitationContent(schema, 'text').ok).toBe(false)
    expect(validateElicitationContent(undefined, {})).toEqual({ ok: true, content: {} })
  })

  test('enum choices carry their display titles', () => {
    expect(elicitationOptions(schema.properties.legacy!)).toEqual([
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
    ])
    expect(elicitationOptions(schema.properties.size!)).toEqual([{ value: 's', label: 'Small' }])
    expect(elicitationOptions(schema.properties.name!)).toBeNull()
  })
})
