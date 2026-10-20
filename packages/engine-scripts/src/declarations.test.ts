import { describe, expect, test } from 'bun:test'

import { renderDeclarations, schemaToType, toIdentifier } from './declarations'

describe('script declarations', () => {
  test('declares each tool as a typed call resolving to its text, its description a doc comment', () => {
    const declared = renderDeclarations([
      {
        name: 'read',
        description: 'Read a file',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Where the file is' },
            limit: { type: 'integer', minimum: 1, default: 20 },
          },
          required: ['path'],
          additionalProperties: false,
        },
      },
    ])
    expect(declared).toBe(
      [
        'declare const tools: {',
        '  /** Read a file */',
        '  read(args: {',
        '  // Where the file is',
        '  path: string;',
        '  // @integer @minimum 1 @default 20',
        '  limit?: number;',
        '}): Promise<string>;',
        '};',
      ].join('\n'),
    )
  })

  test('renders unions, enums, tuples and local references, and stops at recursion', () => {
    expect(schemaToType({ anyOf: [{ type: 'string' }, { type: 'null' }] })).toBe('string | null')
    expect(schemaToType({ enum: ['a', 'b'] })).toBe('"a" | "b"')
    expect(
      schemaToType({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }] }),
    ).toBe('[string, number]')
    const tree = {
      $defs: { node: { type: 'object', properties: { next: { $ref: '#/$defs/node' } } } },
      $ref: '#/$defs/node',
    }
    expect(schemaToType(tree)).toBe('{ next?: unknown; }')
  })

  test('names a tool by an identifier a script can write', () => {
    expect(toIdentifier('mcp__docs__search')).toBe('mcp__docs__search')
    expect(toIdentifier('my-tool')).toBe('my_tool')
    expect(toIdentifier('3d')).toBe('_3d')
  })
})
