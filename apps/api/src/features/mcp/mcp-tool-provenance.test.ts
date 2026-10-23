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

describe('the name an MCP tool reaches the model under', () => {
  const plugin = record({ id: 'plugin:namekit:db', name: 'namekit_db' })

  test('a plugin server’s tool: Claude Code’s name, its own name kept as the identity', () => {
    const tool = buildToolForServer(plugin, client, { name: 'echo', inputSchema: {} })
    expect(tool.modelName).toBe('mcp__plugin_namekit_db__echo')
    expect(tool.name).toBe('mcp_namekit_db_echo')
  })

  test('a Claude Code name past 64 characters falls back to the own name', () => {
    const long = 'q'.repeat(64 - 'mcp__plugin_namekit_db__'.length + 1)
    const tool = buildToolForServer(plugin, client, { name: long, inputSchema: {} })
    expect(tool.modelName).toBeUndefined()
    expect(tool.name.length).toBeLessThanOrEqual(64)
    const fits = buildToolForServer(plugin, client, { name: long.slice(1), inputSchema: {} })
    expect(fits.modelName).toHaveLength(64)
  })

  test('a server the person added keeps its own name on the wire', () => {
    const tool = buildToolForServer(record({}), client, { name: 'create', inputSchema: {} })
    expect(tool.modelName).toBeUndefined()
  })
})
