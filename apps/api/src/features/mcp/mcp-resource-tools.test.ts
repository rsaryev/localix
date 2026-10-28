import { describe, expect, test } from 'bun:test'
import { zodToJsonSchema } from '@localixai/agent'
import { classifyToolCall } from '@localixai/agent/agents'

import {
  createMcpResourceTools,
  buildMcpResourceTools,
  type McpResourcePort,
} from './mcp-resource-tools'

const port: McpResourcePort = {
  async list() {
    return [
      { server: 'github', uri: 'issue://123', name: 'Bug', description: 'a bug' },
      {
        server: 'docs',
        uri: 'file://api/auth',
        name: 'Auth docs',
        annotations: { audience: ['assistant'], priority: 0.8 },
      },
    ]
  },
  async listTemplates() {
    return [
      {
        server: 'github',
        uriTemplate: 'issue://{number}',
        name: 'Issue',
        annotations: { lastModified: '2026-07-22T00:00:00.000Z' },
      },
    ]
  },
  async read(server, uri) {
    if (server !== 'github') throw new Error(`no server ${server}`)
    return [{ uri, text: `contents of ${uri}` }]
  },
}

describe('MCP resource tools', () => {
  const [tool] = createMcpResourceTools(port, ['github', 'docs'])

  // Undeclared reads as `external`, which would put a read-only lister behind every write gate.
  test.each([
    ['list', { action: 'list' }],
    ['list_templates', { action: 'list_templates' }],
    ['Read', { action: 'read', server: 'github', uri: 'issue://1' }],
    ['an unknown action', { action: 'write' }],
  ])('%s classifies as a read', (_label, input) => {
    expect(classifyToolCall(tool, input)).toEqual({ effect: 'read' })
  })

  test('action="list" returns every resource with server + uri', async () => {
    const r = await tool.execute('t', { action: 'list' })
    expect(r.content).toContain('[github] issue://123 — Bug (a bug)')
    expect(r.content).toContain('[docs] file://api/auth — Auth docs')
    expect(r.content).toContain('[annotations: {"audience":["assistant"],"priority":0.8}]')
    expect((r.details as { resources: unknown[] }).resources).toHaveLength(2)
    expect(r.sources).toEqual([
      expect.objectContaining({
        uri: 'issue://123',
        role: 'discovered',
        provider: 'MCP · github',
      }),
      expect.objectContaining({
        uri: 'file://api/auth',
        role: 'discovered',
        provider: 'MCP · docs',
      }),
    ])
  })

  test('action="list_templates" exposes URI templates and annotations', async () => {
    const r = await tool.execute('t', { action: 'list_templates' })
    expect(r.content).toContain('[github] issue://{number} — Issue')
    expect(r.content).toContain('[annotations: {"lastModified":"2026-07-22T00:00:00.000Z"}]')
    expect((r.details as { resourceTemplates: unknown[] }).resourceTemplates).toHaveLength(1)
  })

  test('list tools bound rendered details even when a port returns too many rows', async () => {
    const manyPort: McpResourcePort = {
      ...port,
      list: async () =>
        Array.from({ length: 1_001 }, (_, index) => ({
          server: 'docs',
          uri: `docs://${index}`,
          name: `Doc ${index}`,
        })),
    }
    const [manyList] = createMcpResourceTools(manyPort, ['docs'])

    const result = await manyList.execute('t', { action: 'list' })
    const details = result.details as {
      resources: unknown[]
      totalCount: number
      truncated: boolean
    }
    expect(details.resources).toHaveLength(1_000)
    expect(details.totalCount).toBe(1_001)
    expect(details.truncated).toBe(true)
    expect(String(result.content).length).toBeLessThanOrEqual(64_000)
  })

  test('reports string-budget truncation and marks the model-facing omission', async () => {
    const hugePort: McpResourcePort = {
      ...port,
      list: async () =>
        Array.from({ length: 40 }, (_, index) => ({
          server: 'docs',
          uri: `docs://huge/${index}`,
          name: 'Huge',
          description: 'x'.repeat(100_000),
          annotations: {
            audience: Array.from({ length: 10_000 }, () => 'assistant' as const),
          },
        })),
    }
    const [hugeList] = createMcpResourceTools(hugePort, ['docs'])

    const result = await hugeList.execute('t', { action: 'list' })
    expect(result.content).toContain('output budget reached')
    expect(String(result.content).length).toBeLessThanOrEqual(64_000)
    expect((result.details as { truncated: boolean }).truncated).toBe(true)
  })

  test('action="read" reads by server + uri', async () => {
    const r = await tool.execute('t', {
      action: 'read',
      server: 'github',
      uri: 'issue://123',
    })
    expect(r.content).toBe('contents of issue://123')
    expect(r.sources).toEqual([
      expect.objectContaining({
        uri: 'issue://123',
        role: 'consulted',
        status: 'available',
        provider: 'MCP · github',
      }),
    ])
  })

  test('buildMcpResourceTools returns nothing when no server advertises resources', () => {
    const tools = buildMcpResourceTools({
      resourceServers: [],
      servers: [],
      cwd: '/tmp',
      manager: {
        listResources: async () => [],
        listResourceTemplates: async () => [],
        readResource: async () => [],
      },
    })
    expect(tools).toHaveLength(0)
  })

  test('buildMcpResourceTools yields one consolidated tool when a server advertises resources', () => {
    const tools = buildMcpResourceTools({
      resourceServers: ['github'],
      servers: [],
      cwd: '/tmp',
      manager: {
        listResources: async () => [],
        listResourceTemplates: async () => [],
        readResource: async () => [],
      },
    })
    expect(tools.map((t) => t.name)).toEqual(['McpResources'])
  })

  test('buildMcpResourceTools applies the same user denylist as every other tool source', () => {
    const manager = {
      listResources: async () => [],
      listResourceTemplates: async () => [],
      readResource: async () => [],
    }
    const tools = buildMcpResourceTools({
      resourceServers: ['github'],
      servers: [],
      cwd: '/tmp',
      disabledTools: new Set(['list_mcp_resources', 'read_mcp_resource']),
      manager,
    })
    expect(tools.map((tool) => tool.name)).toEqual(['McpResources'])
    expect(JSON.stringify(zodToJsonSchema(tools[0]!.inputSchema))).toContain('list_templates')
    expect(JSON.stringify(zodToJsonSchema(tools[0]!.inputSchema))).not.toContain('"read"')

    const none = buildMcpResourceTools({
      resourceServers: ['github'],
      servers: [],
      cwd: '/tmp',
      disabledTools: new Set([
        'list_mcp_resources',
        'list_mcp_resource_templates',
        'read_mcp_resource',
      ]),
      manager,
    })
    expect(none).toEqual([])
  })
})
