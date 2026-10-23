import { describe, expect, test } from 'bun:test'

import { attributeName, literalText } from './jsx.ts'

describe('attributeName', () => {
  test('reads a plain JSX attribute name', () => {
    expect(
      attributeName({ type: 'JSXAttribute', name: { type: 'JSXIdentifier', name: 'className' } }),
    ).toBe('className')
  })

  test('is null for a namespaced attribute', () => {
    expect(
      attributeName({ type: 'JSXAttribute', name: { type: 'JSXNamespacedName', name: 'xlink' } }),
    ).toBeNull()
  })
})

describe('literalText', () => {
  test('reads a string literal', () => {
    expect(literalText({ type: 'Literal', value: 'rounded p-1' })).toBe('rounded p-1')
  })

  test('is null for a non-string literal and for a dynamic value', () => {
    expect(literalText({ type: 'Literal', value: 4 })).toBeNull()
    expect(literalText({ type: 'Identifier', name: 'cls' })).toBeNull()
    expect(literalText(undefined)).toBeNull()
  })

  test('joins the static parts of a template literal with spaces', () => {
    const value = {
      type: 'TemplateLiteral',
      quasis: [
        { type: 'TemplateElement', value: { raw: 'rounded px-1' } },
        { type: 'TemplateElement', value: { raw: 'text-xs' } },
      ],
    }
    expect(literalText(value)).toBe('rounded px-1 text-xs')
  })
})
