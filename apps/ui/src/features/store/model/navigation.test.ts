import { describe, expect, test } from 'bun:test'
import { parseSection, storeNav } from './navigation'

describe('the Store’s sections', () => {
  test('a link to the old shelf of skills, agents or MCP servers lands on their one shelf', () => {
    expect(parseSection('package:skill')).toBe('capability:skill')
    expect(parseSection('package:mcp-server')).toBe('capability:mcp-server')
    expect(parseSection('package:plugin')).toBe('package:plugin')
    expect(parseSection('capability:agent')).toBe('capability:agent')
  })

  test('a kind that can make a new item keeps its shelf, empty, so Add is there', () => {
    const ids = storeNav({ shelves: {} } as never, ['skill', 'mini-app']).catalog.map(
      (tab) => tab.id,
    )
    expect(ids).toContain('capability:skill')
    expect(ids).toContain('package:mini-app')
    expect(ids).not.toContain('package:skill')
  })
})
