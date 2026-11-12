import { describe, expect, test } from 'bun:test'

import { agentMcpServers } from './agent-servers'

// sub-agents.md, `mcpServers`: a map is an inline definition in `.mcp.json`'s shape. Which entries
// apply, and how each reads, is the kit's (`plugins/kit/spawn.ts`); this makes them the run's records.
const owner = { userId: 'u', projectId: 'p', agent: 'tester' }

describe('the MCP servers of an agent file', () => {
  test('inline servers become the run’s records; what waits stays skipped', () => {
    const { references, inline, skipped } = agentMcpServers(
      {
        references: ['github'],
        inline: {
          playwright: {
            name: 'playwright',
            transport: 'stdio',
            config: { command: ['npx', '-y', '@playwright/mcp@latest'] },
          },
          docs: {
            name: 'docs',
            transport: 'http',
            config: { url: 'https://docs.example.com/mcp' },
          },
        },
        skipped: ['waiting'],
      },
      owner,
    )
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
    expect(skipped).toEqual(['waiting'])
  })
})
