import { describe, expect, test } from 'bun:test'
import type { McpClientLike } from './mcp-client-contracts'
import { buildToolForServer } from './mcp-tools'
import type { McpServerRecord } from './repository'

const client: McpClientLike = {
  listTools: async () => ({ tools: [] }),
  callTool: async () => ({ content: [] }),
  close: async () => {},
}

const record = (over: Partial<McpServerRecord>): McpServerRecord => ({
  id: 'srv-1',
  userId: 'u',
  projectId: '',
  name: 'memory',
  description: '',
  transport: 'stdio',
  config: {},
  createdAt: 'ts',
  updatedAt: 'ts',
  ...over,
})

describe('an MCP tool as Claude Code names it', () => {
  test('a plugin server’s tool: mcp__plugin_<plugin>_<server>__<tool>, served by plugin:<p>:<s>', () => {
    const tool = buildToolForServer(
      record({ id: 'plugin:my-plugin:database.tools', name: 'my-plugin_database.tools' }),
      client,
      { name: 'run query', inputSchema: { type: 'object' } },
    )
    // "any character outside `A-Z`, `a-z`, `0-9`, `_`, and `-` is replaced with `_`" (mcp.md)
    expect(tool.aliases).toEqual(['mcp__plugin_my-plugin_database_tools__run_query'])
    expect(tool.mcpServer).toEqual({ name: 'plugin:my-plugin:database.tools', source: 'plugin' })
  })

  test('a server the person added: its own name, from the user or a project scope', () => {
    const global = buildToolForServer(record({}), client, { name: 'create', inputSchema: {} })
    expect(global.aliases).toEqual(['mcp__memory__create'])
    expect(global.mcpServer).toEqual({ name: 'memory', source: 'user' })
    const local = buildToolForServer(record({ projectId: 'p1' }), client, {
      name: 'create',
      inputSchema: {},
    })
    expect(local.mcpServer).toEqual({ name: 'memory', source: 'local' })
  })
})
