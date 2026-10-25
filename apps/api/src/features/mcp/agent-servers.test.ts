import { describe, expect, test } from 'bun:test'

import { agentMcpServers } from './agent-servers'

// sub-agents.md, `mcpServers`: a string names a configured server; a map is an inline definition in
// `.mcp.json`'s shape. A project's agent file loads inline servers only once its folder is trusted.
const FILE = [
  'github',
  { playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] } },
  { docs: { type: 'http', url: 'https://docs.example.com/mcp' } },
  { broken: { type: 'http' } },
  42,
]
const owner = { userId: 'u', projectId: 'p', agent: 'tester' }

describe('the MCP servers of an agent file', () => {
  test('names are references; maps become inline servers; what cannot load is skipped', () => {
    const { references, inline, skipped } = agentMcpServers(FILE, {
      ...owner,
      source: 'user',
      projectTrusted: false,
    })
    expect(references).toEqual(['github'])
    expect(inline.map((s) => [s.name, s.transport])).toEqual([
      ['playwright', 'stdio'],
      ['docs', 'http'],
    ])
    expect(inline[0]).toMatchObject({
      id: 'agent:tester:playwright',
      userId: 'u',
      projectId: 'p',
      config: { command: ['npx', '-y', '@playwright/mcp@latest'] },
    })
    expect(skipped).toEqual(['broken'])
  })

  test('a project file’s inline servers wait for trust; its references do not', () => {
    const waiting = agentMcpServers(FILE, { ...owner, source: 'project', projectTrusted: false })
    expect(waiting.inline).toEqual([])
    expect(waiting.references).toEqual(['github'])
    expect(waiting.skipped).toEqual(['playwright', 'docs', 'broken'])
    const trusted = agentMcpServers(FILE, { ...owner, source: 'project', projectTrusted: true })
    expect(trusted.inline).toHaveLength(2)
  })

  test('nothing for a plugin’s agent', () => {
    expect(agentMcpServers(FILE, { ...owner, source: 'plugin', projectTrusted: true })).toEqual({
      references: [],
      inline: [],
      skipped: [],
    })
    expect(
      agentMcpServers(undefined, { ...owner, source: 'user', projectTrusted: true }).inline,
    ).toEqual([])
  })
})
