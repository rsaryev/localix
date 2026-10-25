import { describe, expect, test } from 'bun:test'

import { agentRunMcpServers } from './agent-run-mcp'

const spec = (over: Record<string, unknown> = {}) => ({
  source: 'user',
  fullName: 'tester',
  name: 'tester',
  mcpServers: ['github', { docs: { type: 'http', url: 'https://docs.example.com/mcp' } }],
  ...over,
})
const child = (provenance: Record<string, unknown> = {}) =>
  ({
    id: 'c',
    projectId: 'p',
    provenance: { kind: 'task-delegation', parentSessionId: 'x', toolCallId: 't', ...provenance },
  }) as never
const ctx = { userId: 'u', projectTrusted: true }

describe('the MCP servers a delegated run takes from its agent file', () => {
  test('a delegated child of a person’s agent gets them', () => {
    const found = agentRunMcpServers(child(), spec(), ctx)
    expect(found?.references).toEqual(['github'])
    expect(found?.inline.map((s) => s.name)).toEqual(['docs'])
  })

  test('not a plugin agent, a fork, an ordinary chat, or a file with none', () => {
    expect(agentRunMcpServers(child(), spec({ source: 'plugin' }), ctx)?.inline ?? []).toEqual([])
    expect(
      agentRunMcpServers(
        child({ fork: { baseMessageId: null, snapshotMessageId: 'm' } }),
        spec(),
        ctx,
      ),
    ).toBeUndefined()
    expect(
      agentRunMcpServers({ id: 'r', provenance: { kind: 'root' } } as never, spec(), ctx),
    ).toBeUndefined()
    expect(agentRunMcpServers(child(), spec({ mcpServers: undefined }), ctx)).toBeUndefined()
    expect(agentRunMcpServers(child(), undefined, ctx)).toBeUndefined()
  })
})
