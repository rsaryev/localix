import { describe, expect, test } from 'bun:test'

import { agentMcpServers } from './agent-servers'

// sub-agents.md, `mcpServers`: a map is an inline definition in `.mcp.json`'s shape. Which entries
// apply is the kit's (`plugins/kit/spawn.ts`); this makes server records of the inline ones.
const owner = { userId: 'u', projectId: 'p', agent: 'tester' }

describe('the MCP servers of an agent file', () => {
  test('inline definitions become server records; one that cannot load is skipped', () => {
    const { references, inline, skipped } = agentMcpServers(
      {
        references: ['github'],
        inline: {
          playwright: { type: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@latest'] },
          docs: { type: 'http', url: 'https://docs.example.com/mcp' },
          broken: { type: 'http' },
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
    expect(skipped).toEqual(['waiting', 'broken'])
  })
})
