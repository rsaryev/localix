import { describe, expect, test } from 'bun:test'
import { hasSpecifier, splitDenyList } from './deny-list'

describe('a denylist with specifiers', () => {
  test('splits whole-tool entries, by Localix name, from the entries that only deny calls', () => {
    expect(splitDenyList(['Bash(rm *)', 'Write', 'Read(*)', 'Grep', 'Agent(worker)'])).toEqual({
      tools: ['Write', 'Read', 'Search'],
      patterned: ['Bash(rm *)', 'Agent(worker)'],
    })
  })

  // permissions.md, "Permission rule syntax": `Tool(specifier)`; the kit reads the entry.
  test('an entry has a specifier when the kit reads one, quoted or not', () => {
    expect(['Bash(rm *)', '"Read(*)"', 'Agent(worker)', 'Bash', 'Agent'].map(hasSpecifier)).toEqual(
      [true, true, true, false, false],
    )
  })

  test("an MCP address names Localix's MCP tool; a Localix name stays", () => {
    expect(splitDenyList(['mcp__github__issue', 'Search', 'mcp_x_y']).tools).toEqual([
      'mcp_github_issue',
      'Search',
      'mcp_x_y',
    ])
  })
})
