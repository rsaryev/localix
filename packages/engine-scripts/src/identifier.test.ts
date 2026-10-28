import { describe, expect, test } from 'bun:test'

import { toIdentifier } from './identifier'

describe('the name a script calls a tool by', () => {
  test('keeps a valid identifier and replaces what JavaScript cannot name', () => {
    expect(toIdentifier('mcp__docs__search')).toBe('mcp__docs__search')
    expect(toIdentifier('my-tool')).toBe('my_tool')
    expect(toIdentifier('3d')).toBe('_3d')
  })
})
