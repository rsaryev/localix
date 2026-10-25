import { describe, expect, test } from 'bun:test'

import { createMcpClientManager } from './client-manager'
import { filterToolDefs, type McpClientLike } from './mcp-wire'
import { MCP_DESCRIPTION_MAX_CHARS } from './mcp-tools'
import { mapCallResult } from './mcp-result'
import { McpAuthenticationRequiredError } from './mcp-connect'
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { classifyMcpTool, isTransportError } from './mcp-tools'
import type { McpServerRecord } from './repository'

function makeServer(overrides: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: overrides.id ?? 'srv-1',
    userId: 'user-1',
    projectId: '',
    name: overrides.name ?? 'alpha',
    description: '',
    transport: 'stdio',
    config: overrides.config ?? { command: ['fake-server'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

interface FakeClient extends McpClientLike {
  listToolsCalls: number
  callToolCalls: number
  closed: boolean
  failNextCallWith?: string | Error
}

function makeFakeClient(toolNames: string[] = ['echo']): FakeClient {
  const client: FakeClient = {
    listToolsCalls: 0,
    callToolCalls: 0,
    closed: false,
    onclose: undefined,
    async listTools() {
      client.listToolsCalls += 1
      return {
        tools: toolNames.map((name) => ({
          name,
          description: `${name} tool`,
          inputSchema: { type: 'object', properties: {} },
        })),
      }
    },
    async callTool() {
      client.callToolCalls += 1
      if (client.failNextCallWith) {
        const message = client.failNextCallWith
        client.failNextCallWith = undefined
        throw typeof message === 'string' ? new Error(message) : message
      }
      return { content: [{ type: 'text', text: 'ok' }], isError: false }
    },
    async close() {
      client.closed = true
      client.onclose?.()
    },
  }
  return client
}

function makeResourceClient(
  listResources: NonNullable<McpClientLike['listResources']>,
): McpClientLike {
  return {
    ...makeFakeClient([]),
    getServerCapabilities: () => ({ resources: {} }),
    listResources,
  }
}

function makeResourceTemplateClient(
  listResourceTemplates: NonNullable<McpClientLike['listResourceTemplates']>,
): McpClientLike {
  return {
    ...makeResourceClient(async () => ({ resources: [] })),
    listResourceTemplates,
  }
}

/** Tracks every client handed out, in order, per server name. */
function makeConnectTracker(toolNames: string[] = ['echo']) {
  const created: FakeClient[] = []
  let connectCalls = 0
  const connect = async (_server: McpServerRecord, _cwd: string): Promise<McpClientLike> => {
    connectCalls += 1
    const client = makeFakeClient(toolNames)
    created.push(client)
    return client
  }
  return {
    connect,
    created,
    get connectCalls() {
      return connectCalls
    },
  }
}

const GATHER_OPTS = { cwd: '/tmp', scope: 'user-1:' }

describe('createMcpClientManager', () => {
  test('settings probe warms the same cached client the next chat gather uses', async () => {
    const tracker = makeConnectTracker(['searchGitHub'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer({ name: 'grep' })

    expect(await manager.probe(server, '/tmp')).toEqual({
      ok: true,
      tools: ['searchGitHub'],
      availableTools: ['searchGitHub'],
    })
    const gathered = await manager.gather([server], GATHER_OPTS)

    expect(gathered.servers).toEqual([{ name: 'grep', ok: true, toolCount: 1, cached: false }])
    expect(gathered.tools.map((tool) => tool.name)).toEqual(['mcp_grep_searchGitHub'])
    expect(tracker.connectCalls).toBe(1)
    expect(tracker.created[0].listToolsCalls).toBe(1)
  })

  test('a global HTTP probe is reusable from a different session cwd', async () => {
    const tracker = makeConnectTracker(['searchGitHub'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer({
      name: 'grep',
      transport: 'http',
      config: { url: 'https://mcp.grep.app' },
    })

    await manager.probe(server, '/settings-process-cwd')
    const gathered = await manager.gather([server], {
      cwd: '/session-sandbox-cwd',
      scope: 'user-1:session',
    })

    expect(gathered.servers[0]).toMatchObject({ ok: true, cached: false })
    expect(tracker.connectCalls).toBe(1)
  })

  /**
   * A probe answers for the SERVER, not for a scope: which of its tools a role may reach is a
   * rule, and a health check is not given a role to resolve one against.
   */
  test('probe reports what the server offers, unnarrowed', async () => {
    const tracker = makeConnectTracker(['read', 'write'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer({ config: { command: ['server'] } })

    expect(await manager.probe(server, '/tmp')).toEqual({
      ok: true,
      tools: ['read', 'write'],
      availableTools: ['read', 'write'],
    })
  })

  test('identical remote configs never share a client across users', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const config = { url: 'https://example.test/mcp' }

    await manager.gather(
      [makeServer({ id: 'shared-looking-id', userId: 'user-a', transport: 'http', config })],
      { cwd: '/tmp/a', scope: 'user-a:' },
    )
    await manager.gather(
      [makeServer({ id: 'shared-looking-id', userId: 'user-b', transport: 'http', config })],
      { cwd: '/tmp/b', scope: 'user-b:' },
    )

    expect(tracker.connectCalls).toBe(2)
  })

  test('probe classifies an explicit OAuth challenge separately from generic failures', async () => {
    const manager = createMcpClientManager({
      connect: async () => {
        throw new McpAuthenticationRequiredError()
      },
    })

    expect(await manager.probe(makeServer({ transport: 'http' }), '/tmp')).toMatchObject({
      ok: false,
      tools: [],
      authRequired: true,
    })
  })

  // A tool DEFINITION rides every model request, unlike a tool RESULT which is paid once. Both
  // the count and the schema arrived from the server uncapped — the schema as a bare
  // `as McpJsonSchema` cast — so 10_000 tools or a 5 MB schema was a permanent per-request cost.
  // Descriptions were already bounded, which is what made these two read as oversights.
  test('caps how many tools one server may contribute', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `tool${i}`)
    const tracker = makeConnectTracker(many)
    const manager = createMcpClientManager({ connect: tracker.connect })

    const gathered = await manager.gather([makeServer()], GATHER_OPTS)
    expect(gathered.tools).toHaveLength(256)
    // The kept ones are the first, not an arbitrary slice.
    expect(gathered.tools[0]!.name).toBe('mcp_alpha_tool0')
  })

  test('drops a tool whose input schema is absurdly large, keeping its siblings', async () => {
    const tracker = makeConnectTracker(['small', 'huge'])
    const inner = tracker.connect
    const manager = createMcpClientManager({
      connect: async (...args: Parameters<typeof inner>) => {
        const client = await inner(...args)
        const original = client.listTools.bind(client)
        client.listTools = async (...listArgs: Parameters<typeof original>) => {
          const listed = await original(...listArgs)
          return {
            tools: (listed.tools ?? []).map((def) =>
              def.name === 'huge'
                ? {
                    ...def,
                    // A truncated JSON Schema is not a schema, so an over-limit one is dropped.
                    inputSchema: { type: 'object', description: 'x'.repeat(200_000) },
                  }
                : def,
            ),
          }
        }
        return client
      },
    })

    const gathered = await manager.gather([makeServer()], GATHER_OPTS)
    expect(gathered.tools.map((t) => t.name)).toEqual(['mcp_alpha_small'])
  })

  test('cache hit: second gather reuses the client without reconnecting or re-listing tools', async () => {
    const tracker = makeConnectTracker(['echo', 'sum'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer()

    const first = await manager.gather([server], GATHER_OPTS)
    expect(first.servers).toEqual([{ name: 'alpha', ok: true, toolCount: 2, cached: false }])
    expect(first.tools.map((t) => t.name)).toEqual(['mcp_alpha_echo', 'mcp_alpha_sum'])

    const second = await manager.gather([server], GATHER_OPTS)
    expect(second.servers).toEqual([{ name: 'alpha', ok: true, toolCount: 2, cached: false }])
    expect(second.tools.map((t) => t.name)).toEqual(['mcp_alpha_echo', 'mcp_alpha_sum'])

    expect(tracker.connectCalls).toBe(1)
    expect(tracker.created[0].listToolsCalls).toBe(1)
    expect(tracker.created[0].closed).toBe(false)
    expect(manager.size()).toBe(1)
  })

  test('config change produces a new key: old client is evicted, new one connected', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })

    await manager.gather(
      [makeServer({ config: { command: ['fake-server', '--v1'] } })],
      GATHER_OPTS,
    )
    await manager.gather(
      [makeServer({ config: { command: ['fake-server', '--v2'] } })],
      GATHER_OPTS,
    )

    expect(tracker.connectCalls).toBe(2)
    // Old config disappeared from the scope's gathered set → disposed.
    await Bun.sleep(0)
    expect(tracker.created[0].closed).toBe(true)
    expect(tracker.created[1].closed).toBe(false)
    expect(manager.size()).toBe(1)
  })

  test('broken client falls back to Cached metadata and reconnects on its next tool call', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer()

    await manager.gather([server], GATHER_OPTS)
    // Simulate the server dying: the SDK fires onclose on the client.
    tracker.created[0].onclose?.()

    const result = await manager.gather([server], GATHER_OPTS)
    expect(result.servers).toEqual([{ name: 'alpha', ok: true, toolCount: 1, cached: true }])
    expect(tracker.connectCalls).toBe(1)

    const toolResult = await result.tools[0].execute('call-1', {})
    expect(toolResult.isError).toBeUndefined()
    expect(tracker.connectCalls).toBe(2)
    expect(tracker.created[0].closed).toBe(true)
    expect(manager.size()).toBe(1)
  })

  test('transport-level callTool failure marks the client broken → next gather reconnects', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer()

    const first = await manager.gather([server], GATHER_OPTS)
    // Classified by the SDK's error code, not its text, and independent of the
    // bounded preview the model/UI copy is truncated to.
    tracker.created[0].failNextCallWith = new McpError(
      ErrorCode.ConnectionClosed,
      `${'x'.repeat(100_000)} Connection closed`,
    )
    const toolResult = await first.tools[0].execute('call-1', {})
    expect(toolResult.isError).toBe(true)
    expect(toolResult.content).toContain('MCP error truncated')

    const second = await manager.gather([server], GATHER_OPTS)
    expect(second.servers[0]).toMatchObject({ ok: true, cached: true })
    expect(tracker.connectCalls).toBe(1)

    const retry = await second.tools[0].execute('call-2', {})
    expect(retry.isError).toBeUndefined()
    expect(tracker.connectCalls).toBe(2)
    expect(tracker.created[0].closed).toBe(true)
  })

  test('tool-level callTool failure does NOT break the cached client', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer()

    const first = await manager.gather([server], GATHER_OPTS)
    tracker.created[0].failNextCallWith = 'invalid arguments: x must be a number'
    const toolResult = await first.tools[0].execute('call-1', {})
    expect(toolResult.isError).toBe(true)

    const second = await manager.gather([server], GATHER_OPTS)
    expect(second.servers[0]).toMatchObject({ ok: true, cached: false })
    expect(tracker.connectCalls).toBe(1)
  })

  test('bounds an oversized thrown MCP error before it reaches model and persisted fields', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const first = await manager.gather([makeServer()], GATHER_OPTS)
    tracker.created[0].failNextCallWith = '\ud83d\udea8'.repeat(100_000)

    const result = await first.tools[0].execute('call-1', {})
    const error = result.error

    expect(result.isError).toBe(true)
    expect(Buffer.byteLength(result.content, 'utf8')).toBeLessThan(65_000)
    expect(result.content).toContain('MCP error truncated')
    expect(error?.message).toContain('MCP error truncated')
    expect(Buffer.byteLength(error?.message ?? '', 'utf8')).toBeLessThanOrEqual(64_000)
    expect(Buffer.byteLength(error?.userMessage ?? '', 'utf8')).toBeLessThan(65_000)
  })

  test('invalidation: server removed from the gathered set has its client disposed and evicted', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const alpha = makeServer({ id: 'a', name: 'alpha' })
    const beta = makeServer({ id: 'b', name: 'beta' })

    await manager.gather([alpha, beta], GATHER_OPTS)
    expect(manager.size()).toBe(2)

    await manager.gather([alpha], GATHER_OPTS)
    await Bun.sleep(0)
    expect(manager.size()).toBe(1)
    // Exactly one of the two clients (beta's) must be closed; alpha's stays open.
    expect(tracker.created.filter((c) => c.closed)).toHaveLength(1)
    expect(tracker.created.filter((c) => !c.closed)).toHaveLength(1)
  })

  test('releasing a scope disconnects what only it referenced and keeps what another scope holds', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const shared = makeServer({ id: 's', name: 'shared' })
    const inline = makeServer({ id: 'i', name: 'inline', config: { command: ['inline-server'] } })

    await manager.gather([shared], { cwd: '/tmp', scope: 'run:parent' })
    await manager.gather([shared, inline], { cwd: '/tmp', scope: 'run:child' })
    expect(manager.size()).toBe(2)

    await manager.releaseScope('run:child')
    await Bun.sleep(0)
    expect(manager.size()).toBe(1)
    expect(tracker.created.filter((c) => c.closed)).toHaveLength(1)
    // Releasing a scope nobody gathered is harmless.
    await manager.releaseScope('run:nobody')
  })

  test('invalidation is per-scope: another scope keeps its clients alive', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const alpha = makeServer({ name: 'alpha' })
    const beta = makeServer({ name: 'beta', config: { command: ['other-server'] } })

    await manager.gather([alpha], { cwd: '/tmp', scope: 'user-1:proj-a' })
    await manager.gather([beta], { cwd: '/tmp', scope: 'user-1:proj-b' })
    await Bun.sleep(0)

    // proj-b's gather doesn't include alpha, but proj-a still references it.
    expect(manager.size()).toBe(2)
    expect(tracker.created.every((c) => !c.closed)).toBe(true)
  })

  test('single-flight: concurrent gathers for the same server share one connect', async () => {
    let connectCalls = 0
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const client = makeFakeClient()
    const manager = createMcpClientManager({
      connect: async () => {
        connectCalls += 1
        await gate
        return client
      },
    })
    const server = makeServer()

    const [first, second] = await Promise.all([
      manager.gather([server], GATHER_OPTS),
      manager.gather([server], GATHER_OPTS),
      Promise.resolve().then(() => release?.()),
    ]).then(([a, b]) => [a, b])

    expect(connectCalls).toBe(1)
    expect(first.tools).toHaveLength(1)
    expect(second.tools).toHaveLength(1)
    expect(first.servers[0].ok).toBe(true)
    expect(second.servers[0].ok).toBe(true)
    expect(manager.size()).toBe(1)
  })

  test('concurrent first tool calls start a Cached server exactly once', async () => {
    const tracker = makeConnectTracker(['echo'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer()

    // Seed metadata as a prior process/probe would, then remove every Live connection.
    await manager.probe(server, GATHER_OPTS.cwd)
    await manager.disposeAll()
    const gathered = await manager.gather([server], GATHER_OPTS)

    expect(gathered.servers).toEqual([{ name: 'alpha', ok: true, toolCount: 1, cached: true }])
    expect(tracker.connectCalls).toBe(1)

    const [first, second] = await Promise.all([
      gathered.tools[0].execute('call-1', { value: 1 }),
      gathered.tools[0].execute('call-2', { value: 2 }),
    ])

    expect(first.isError).toBeUndefined()
    expect(second.isError).toBeUndefined()
    expect(tracker.connectCalls).toBe(2)
    expect(tracker.created[1].listToolsCalls).toBe(1)
    expect(tracker.created[1].callToolCalls).toBe(2)
  })

  test('a failed first-use connect is evicted so the next call retries', async () => {
    let connectCalls = 0
    const liveClients: FakeClient[] = []
    const manager = createMcpClientManager({
      connect: async () => {
        connectCalls += 1
        if (connectCalls === 2) throw new Error('temporary startup failure')
        const connected = makeFakeClient(['echo'])
        liveClients.push(connected)
        return connected
      },
    })
    const server = makeServer()

    await manager.probe(server, GATHER_OPTS.cwd)
    await manager.disposeAll()
    const gathered = await manager.gather([server], GATHER_OPTS)

    const failed = await gathered.tools[0].execute('call-1', {})
    expect(failed.isError).toBe(true)
    expect(failed.content).toContain('temporary startup failure')
    expect(manager.size()).toBe(0)

    const retried = await gathered.tools[0].execute('call-2', {})
    expect(retried.isError).toBeUndefined()
    expect(connectCalls).toBe(3)
    expect(liveClients[1].callToolCalls).toBe(1)
  })

  test('stale Cached tools reconcile to Live and a removed tool fails clearly', async () => {
    let connectCalls = 0
    const liveClients: FakeClient[] = []
    const warnings: Array<{ message: string; meta?: unknown }> = []
    const manager = createMcpClientManager({
      connect: async () => {
        connectCalls += 1
        const connected = makeFakeClient(connectCalls === 1 ? ['removed'] : ['replacement'])
        liveClients.push(connected)
        return connected
      },
    })
    const server = makeServer()

    await manager.probe(server, GATHER_OPTS.cwd)
    await manager.disposeAll()
    const cached = await manager.gather([server], {
      ...GATHER_OPTS,
      logger: {
        warn(message, meta) {
          warnings.push({ message, meta })
        },
      },
    })

    expect(cached.servers[0]).toMatchObject({ cached: true })
    expect(cached.tools.map((tool) => tool.name)).toEqual(['mcp_alpha_removed'])
    const staleCall = await cached.tools[0].execute('call-1', {})

    expect(staleCall.isError).toBe(true)
    expect(staleCall.content).toContain(
      'cached MCP tool "removed" is no longer available on server "alpha"',
    )
    expect(liveClients[1].callToolCalls).toBe(0)
    expect(warnings.some(({ message }) => message.includes('differs from cached metadata'))).toBe(
      true,
    )

    const live = await manager.gather([server], GATHER_OPTS)
    expect(live.servers[0]).toMatchObject({ cached: false })
    expect(live.tools.map((tool) => tool.name)).toEqual(['mcp_alpha_replacement'])
  })

  test('a failing server is isolated: recorded as error, others still gathered, not cached', async () => {
    const goodTracker = makeConnectTracker()
    let badAttempts = 0
    const manager = createMcpClientManager({
      connect: async (server, cwd) => {
        if (server.name === 'bad') {
          badAttempts += 1
          throw new Error('spawn fake-bad ENOENT')
        }
        return goodTracker.connect(server, cwd)
      },
    })
    const good = makeServer({ name: 'good' })
    const bad = makeServer({ name: 'bad', config: { command: ['fake-bad'] } })

    const result = await manager.gather([good, bad], GATHER_OPTS)
    const byName = Object.fromEntries(result.servers.map((s) => [s.name, s]))
    expect(byName.good.ok).toBe(true)
    expect(byName.bad.ok).toBe(false)
    expect(byName.bad.error).toContain('ENOENT')
    expect(result.tools.map((t) => t.name)).toEqual(['mcp_good_echo'])

    // Failed connects are not cached — the next gather retries.
    await manager.gather([good, bad], GATHER_OPTS)
    expect(badAttempts).toBe(2)
    expect(goodTracker.connectCalls).toBe(1)
  })

  test('a required server failure rejects startup with every failed server named', async () => {
    const manager = createMcpClientManager({
      connect: async (server) => {
        throw new Error(`${server.name} unavailable`)
      },
    })

    const result = manager.gather(
      [
        makeServer({ name: 'docs', config: { command: ['docs'], required: true } }),
        makeServer({ name: 'issues', config: { command: ['issues'], required: true } }),
      ],
      GATHER_OPTS,
    )

    expect(result).rejects.toThrow(
      'required MCP servers failed to initialize: docs: docs unavailable; issues: issues unavailable',
    )
  })

  test('a required server waits for startup instead of being backgrounded', async () => {
    const manager = createMcpClientManager({
      connect: async () => {
        await Bun.sleep(10)
        return makeFakeClient(['echo'])
      },
    })

    const result = await manager.gather(
      [makeServer({ config: { command: ['fake-server'], required: true } })],
      { ...GATHER_OPTS, connectBudgetMs: 1 },
    )

    expect(result.servers).toEqual([{ name: 'alpha', ok: true, toolCount: 1, cached: false }])
  })

  test('a required server whose connector never settles still has a startup deadline', async () => {
    const manager = createMcpClientManager({
      connect: () => new Promise<McpClientLike>(() => {}),
      startupTimeoutMs: 5,
    })

    const result = manager.gather(
      [makeServer({ config: { command: ['hung-server'], required: true } })],
      GATHER_OPTS,
    )

    expect(result).rejects.toThrow(
      'required MCP servers failed to initialize: alpha: MCP server "alpha" startup timed out after 5ms',
    )
  })

  test('disabled servers are skipped without touching the cache', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    // A withheld server never reaches the manager: the run filters by the scope's rules.
    const result = await manager.gather([], GATHER_OPTS)
    expect(result.tools).toHaveLength(0)
    expect(result.servers).toHaveLength(0)
    expect(tracker.connectCalls).toBe(0)
  })

  test('disposeAll closes every cached client and empties the cache', async () => {
    const tracker = makeConnectTracker()
    const manager = createMcpClientManager({ connect: tracker.connect })
    const alpha = makeServer({ name: 'alpha' })
    const beta = makeServer({ name: 'beta', config: { command: ['other-server'] } })

    await manager.gather([alpha, beta], GATHER_OPTS)
    expect(manager.size()).toBe(2)

    await manager.disposeAll()
    expect(manager.size()).toBe(0)
    expect(tracker.created.every((c) => c.closed)).toBe(true)

    // Shutdown drops Live clients but retains metadata, so the next gather stays cold.
    const again = await manager.gather([alpha], GATHER_OPTS)
    expect(again.servers[0]).toMatchObject({ ok: true, cached: true })
    expect(tracker.connectCalls).toBe(2)

    await again.tools[0].execute('call-1', {})
    expect(tracker.connectCalls).toBe(3)
  })
})

describe('per-tool policy + description cap', () => {
  test("the caller's policy decides which tools the gather exposes", async () => {
    const tracker = makeConnectTracker(['echo', 'sum', 'danger'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer({ config: { command: ['fake-server'] } })

    const result = await manager.gather([server], {
      ...GATHER_OPTS,
      toolPolicy: (_serverName, toolName) => toolName !== 'danger',
    })
    expect(result.tools.map((t) => t.name)).toEqual(['mcp_alpha_echo', 'mcp_alpha_sum'])
    expect(result.servers[0]).toMatchObject({ ok: true, toolCount: 2 })
  })

  test('the policy is asked per SERVER, so two servers can differ', async () => {
    const tracker = makeConnectTracker(['echo', 'danger'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const alpha = makeServer({ config: { command: ['fake-server'] } })
    const beta = makeServer({ id: 'beta', name: 'beta', config: { command: ['fake-server'] } })

    const result = await manager.gather([alpha, beta], {
      ...GATHER_OPTS,
      toolPolicy: (serverName, toolName) => !(serverName === 'alpha' && toolName === 'danger'),
    })
    expect(result.tools.map((t) => t.name)).toEqual([
      'mcp_alpha_echo',
      'mcp_beta_echo',
      'mcp_beta_danger',
    ])
  })

  /** No policy is not "deny everything": a server nobody narrowed keeps all of its tools. */
  test('no policy exposes every tool the server offers', async () => {
    const tracker = makeConnectTracker(['echo', 'sum', 'danger'])
    const manager = createMcpClientManager({ connect: tracker.connect })
    const server = makeServer({ config: { command: ['fake-server'] } })

    const result = await manager.gather([server], GATHER_OPTS)
    expect(result.tools).toHaveLength(3)
  })

  test('retains MCP behavior hints and derives a fail-safe mutates classification', async () => {
    const client = makeFakeClient([])
    client.listTools = async () => ({
      tools: [
        {
          name: 'read',
          inputSchema: { type: 'object' },
          annotations: {
            readOnlyHint: true,
            destructiveHint: false,
            idempotentHint: true,
            openWorldHint: false,
          },
        },
        {
          name: 'write',
          inputSchema: { type: 'object' },
          annotations: {
            readOnlyHint: false,
            destructiveHint: true,
            idempotentHint: false,
            openWorldHint: true,
          },
        },
        {
          name: 'conflict',
          inputSchema: { type: 'object' },
          annotations: { readOnlyHint: true, destructiveHint: true },
        },
        { name: 'legacy', inputSchema: { type: 'object' } },
      ],
    })
    const manager = createMcpClientManager({ connect: async () => client })

    const result = await manager.gather([makeServer()], GATHER_OPTS)
    const byName = new Map(result.tools.map((tool) => [tool.name, tool]))

    expect(byName.get('mcp_alpha_read')).toMatchObject({
      mutates: false,
      behaviorHints: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    })
    expect(byName.get('mcp_alpha_write')).toMatchObject({
      mutates: true,
      behaviorHints: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      },
    })
    expect(byName.get('mcp_alpha_conflict')?.mutates).toBe(true)
    expect(byName.get('mcp_alpha_legacy')).toMatchObject({ mutates: true })
    expect(byName.get('mcp_alpha_legacy')?.behaviorHints).toBeUndefined()

    // The per-call class rides the built tool, whatever the arguments.
    const classOf = (name: string) => byName.get(name)?.classify?.({ any: 'args' })
    expect(classOf('mcp_alpha_read')).toEqual({ effect: 'read' })
    expect(classOf('mcp_alpha_write')).toEqual({ effect: 'external', irreversible: true })
    expect(classOf('mcp_alpha_conflict')).toEqual({ effect: 'external', irreversible: true })
    expect(classOf('mcp_alpha_legacy')).toEqual({ effect: 'external' })
  })

  test.each([
    ['read-only', { readOnlyHint: true }, { effect: 'read' }],
    [
      'read-only, explicitly not destructive',
      { readOnlyHint: true, destructiveHint: false },
      {
        effect: 'read',
      },
    ],
    ['a plain writer', { readOnlyHint: false }, { effect: 'external' }],
    ['destructive', { destructiveHint: true }, { effect: 'external', irreversible: true }],
    // Contradictory hints are believed on the dangerous half.
    [
      'read-only AND destructive',
      { readOnlyHint: true, destructiveHint: true },
      { effect: 'external', irreversible: true },
    ],
    ['no annotations at all', undefined, { effect: 'external' }],
  ] as const)('classifyMcpTool: %s', (_label, annotations, expected) => {
    expect(classifyMcpTool(annotations)).toEqual(expected)
  })

  test('excludes explicit UI-only tools while keeping legacy and model-visible tools', async () => {
    const client = makeFakeClient([])
    client.listTools = async () => ({
      tools: [
        { name: 'legacy', inputSchema: { type: 'object' } },
        {
          name: 'app_only',
          inputSchema: { type: 'object' },
          _meta: { ui: { visibility: ['app'] } },
        },
        {
          name: 'model_only',
          inputSchema: { type: 'object' },
          _meta: { ui: { visibility: ['model'] } },
        },
        {
          name: 'app_and_model',
          inputSchema: { type: 'object' },
          _meta: { ui: { visibility: ['app', 'model'] } },
        },
        {
          name: 'empty_visibility',
          inputSchema: { type: 'object' },
          _meta: { ui: { visibility: [] } },
        },
        {
          name: 'malformed_visibility',
          inputSchema: { type: 'object' },
          _meta: { ui: { visibility: 'app' } },
        },
      ],
    })
    const manager = createMcpClientManager({ connect: async () => client })

    const result = await manager.gather([makeServer()], GATHER_OPTS)

    expect(result.tools.map((tool) => tool.name)).toEqual([
      'mcp_alpha_legacy',
      'mcp_alpha_model_only',
      'mcp_alpha_app_and_model',
      'mcp_alpha_malformed_visibility',
    ])
    expect(result.servers[0]).toMatchObject({ ok: true, toolCount: 4 })
  })

  test('gather maps each tool to its server name', async () => {
    const tracker = makeConnectTracker(['echo'])
    const manager = createMcpClientManager({ connect: tracker.connect })

    const result = await manager.gather([makeServer()], GATHER_OPTS)
    expect(result.serverByTool).toEqual({ mcp_alpha_echo: 'alpha' })
  })

  test('tool descriptions are capped at MCP_DESCRIPTION_MAX_CHARS', async () => {
    const longDescription = 'x'.repeat(MCP_DESCRIPTION_MAX_CHARS + 500)
    const connect = async (): Promise<McpClientLike> => {
      const client = makeFakeClient(['echo'])
      client.listTools = async () => ({
        tools: [
          {
            name: 'echo',
            description: longDescription,
            inputSchema: { type: 'object', properties: {} },
          },
        ],
      })
      return client
    }
    const manager = createMcpClientManager({ connect })

    const result = await manager.gather([makeServer()], GATHER_OPTS)
    const description = result.tools[0]!.description
    expect(description.startsWith('[MCP: alpha] ')).toBe(true)
    expect(description.endsWith('…')).toBe(true)
    expect(description.length).toBe('[MCP: alpha] '.length + MCP_DESCRIPTION_MAX_CHARS)
  })

  test('slow connect is backgrounded (does not block the turn) and joins the next gather', async () => {
    let resolveConnect: (c: McpClientLike) => void = () => {}
    let connectCalls = 0
    const connect = (_s: McpServerRecord, _cwd: string): Promise<McpClientLike> => {
      connectCalls += 1
      return new Promise<McpClientLike>((resolve) => {
        resolveConnect = resolve
      })
    }
    const manager = createMcpClientManager({ connect })
    const server = makeServer()

    // First gather: connect never resolves within the budget → returns fast,
    // server marked pending, no tools, no second connect attempt.
    const first = await manager.gather([server], { ...GATHER_OPTS, connectBudgetMs: 10 })
    expect(first.tools).toEqual([])
    expect(first.servers).toEqual([
      { name: 'alpha', ok: false, toolCount: 0, cached: false, pending: true },
    ])
    expect(connectCalls).toBe(1)

    // The background connect now completes; the cached entry resolves.
    resolveConnect(makeFakeClient(['echo']))
    await Bun.sleep(0)

    // Next gather reuses the same in-flight entry — tools available, no reconnect.
    const second = await manager.gather([server], { ...GATHER_OPTS, connectBudgetMs: 1_000 })
    expect(second.tools.map((t) => t.name)).toEqual(['mcp_alpha_echo'])
    expect(connectCalls).toBe(1)
  })
})

describe('filterToolDefs', () => {
  const defs = [{ name: 'a' }, { name: 'b' }, { name: 'c' }]

  test('no policy → every model-visible tool', () => {
    expect(filterToolDefs(defs)).toEqual(defs)
  })

  test('the caller decides which names survive', () => {
    expect(filterToolDefs(defs, (name) => name !== 'b')).toEqual([{ name: 'a' }, { name: 'c' }])
  })

  /** A server's own `ui.visibility` is its statement, and policy cannot put a tool back. */
  test('a policy cannot re-admit a tool the server hides from models', () => {
    const hidden = [{ name: 'a' }, { name: 'ui-only', _meta: { ui: { visibility: ['ui'] } } }]

    expect(filterToolDefs(hidden, () => true)).toEqual([{ name: 'a' }])
  })
})

describe('mapCallResult — bounds an oversized MCP result', () => {
  test('caps cumulative text and marks truncation; small results untouched', () => {
    const small = mapCallResult([{ type: 'text', text: 'hello' }] as never, false)
    expect(small.content).toBe('hello')

    const huge = mapCallResult([{ type: 'text', text: 'x'.repeat(200_000) }] as never, false)
    expect(huge.content.length).toBeLessThan(65_000) // ~64KB cap + marker
    expect(huge.content).toContain('truncated at 64000 chars')
  })

  test('budget is CUMULATIVE across parts (text + a later text part)', () => {
    const r = mapCallResult(
      [
        { type: 'text', text: 'a'.repeat(50_000) },
        { type: 'text', text: 'b'.repeat(50_000) },
      ] as never,
      false,
    )
    expect(r.content.length).toBeLessThan(65_000)
    expect(r.content).toContain('truncated')
  })

  test('image parts pass through (bounded separately by run image downscaling)', () => {
    const r = mapCallResult(
      [{ type: 'image', data: 'AAAA', mimeType: 'image/png' }] as never,
      false,
    )
    expect(r.contentParts?.some((p) => p.type === 'image')).toBe(true)
    expect(r.content).toContain('[image]')
  })
})

describe('namespaced-name collision dedup', () => {
  test('two servers whose names sanitize to the same prefix do not shadow each other', async () => {
    const connect = async () => makeFakeClient(['echo'])
    const manager = createMcpClientManager({ connect })
    // "git-hub" and "git_hub" both sanitize to mcp_git_hub_echo.
    const a = makeServer({ id: 'a', name: 'git-hub' })
    const b = makeServer({ id: 'b', name: 'git_hub', config: { command: ['other'] } })
    const res = await manager.gather([a, b], { cwd: '/tmp', scope: 'user-1:' })
    const names = res.tools.map((t) => t.name)
    expect(names).toHaveLength(2) // both tools present, neither dropped
    expect(new Set(names).size).toBe(2) // and they are DISTINCT
    expect(names[0]).toBe('mcp_git_hub_echo')
    expect(names[1]).toBe('mcp_git_hub_echo_2') // disambiguated
    // serverByTool maps each distinct name to its own server.
    expect(res.serverByTool['mcp_git_hub_echo']).toBeTruthy()
    expect(res.serverByTool['mcp_git_hub_echo_2']).toBeTruthy()
  })
})

/**
 * The tool block is ONE cached segment on the anthropic wire (cache_control rides the last
 * tool definition), and `disambiguate` renames whoever is seen second. Both therefore hang
 * on the order `gather` assembles in — which used to be connect-RESOLUTION order.
 */
describe("gather assembles in the caller's server order, not connect order", () => {
  const slowThenFast = (slowName: string) => {
    const connect = async (server: McpServerRecord): Promise<McpClientLike> => {
      // The first-listed server answers LAST — the shape that used to invert everything.
      if (server.name === slowName) await new Promise((r) => setTimeout(r, 25))
      return makeFakeClient(['search'])
    }
    return connect
  }

  test('tool order follows the input, even when the first server is the slowest', async () => {
    const manager = createMcpClientManager({ connect: slowThenFast('alpha') })
    const gather = await manager.gather(
      [makeServer({ id: 'a', name: 'alpha' }), makeServer({ id: 'b', name: 'beta' })],
      GATHER_OPTS,
    )
    expect(gather.tools.map((t) => t.name)).toEqual(['mcp_alpha_search', 'mcp_beta_search'])
    expect(gather.servers.map((s) => s.name)).toEqual(['alpha', 'beta'])
  })

  test('a name collision is won by the FIRST-LISTED server, not the fastest', async () => {
    // `git-hub` and `git_hub` both sanitize to `mcp_git_hub_search` — the clash
    // mcp-tools.ts documents. Whoever loses gets the `_2` suffix; that must be a
    // property of the config order, or the model's tool name changes owner between
    // turns while the transcript still refers to it.
    const manager = createMcpClientManager({ connect: slowThenFast('git-hub') })
    const gather = await manager.gather(
      [makeServer({ id: 'a', name: 'git-hub' }), makeServer({ id: 'b', name: 'git_hub' })],
      GATHER_OPTS,
    )
    expect(gather.serverByTool['mcp_git_hub_search']).toBe('git-hub')
    expect(gather.serverByTool['mcp_git_hub_search_2']).toBe('git_hub')
  })

  test('servers still connect CONCURRENTLY — the reverse direction', async () => {
    // Assembling in order must not serialize the connects: 3 servers sleeping 25ms each
    // take ~25ms in parallel and ~75ms if this regressed into a sequential await loop.
    const connect = async (): Promise<McpClientLike> => {
      await new Promise((r) => setTimeout(r, 25))
      return makeFakeClient(['echo'])
    }
    const manager = createMcpClientManager({ connect })
    const started = performance.now()
    await manager.gather(
      [
        makeServer({ id: 'a', name: 'a' }),
        makeServer({ id: 'b', name: 'b' }),
        makeServer({ id: 'c', name: 'c' }),
      ],
      GATHER_OPTS,
    )
    expect(performance.now() - started).toBeLessThan(60)
  })
})

describe('resources/list enumeration', () => {
  test('results follow server order even when the first server responds last', async () => {
    const manager = createMcpClientManager({
      connect: async (server) =>
        makeResourceClient(async () => {
          if (server.name === 'alpha') await Bun.sleep(25)
          return { resources: [{ uri: `${server.name}://resource`, name: server.name }] }
        }),
    })
    const resources = await manager.listResources(
      [makeServer({ id: 'a', name: 'alpha' }), makeServer({ id: 'b', name: 'beta' })],
      '/tmp',
    )

    expect(resources.map((resource) => resource.server)).toEqual(['alpha', 'beta'])
    expect(resources.map((resource) => resource.uri)).toEqual([
      'alpha://resource',
      'beta://resource',
    ])
  })

  test('follows nextCursor until every page is collected in page order', async () => {
    const seenParams: Array<{ cursor?: string } | undefined> = []
    const pages = new Map<string | undefined, { uri: string; nextCursor?: string }>([
      [undefined, { uri: 'resource://one', nextCursor: 'page-2' }],
      ['page-2', { uri: 'resource://two', nextCursor: 'page-3' }],
      ['page-3', { uri: 'resource://three' }],
    ])
    const manager = createMcpClientManager({
      connect: async () =>
        makeResourceClient(async (params) => {
          seenParams.push(params)
          const page = pages.get(params?.cursor)
          if (!page) throw new Error('unexpected cursor')
          return {
            resources: [{ uri: page.uri, name: page.uri }],
            nextCursor: page.nextCursor,
          }
        }),
    })

    const resources = await manager.listResources([makeServer()], '/tmp')

    expect(seenParams).toEqual([undefined, { cursor: 'page-2' }, { cursor: 'page-3' }])
    expect(resources.map((resource) => resource.uri)).toEqual([
      'resource://one',
      'resource://two',
      'resource://three',
    ])
  })

  test('a repeated cursor drops only the failing server and cannot loop forever', async () => {
    let badCalls = 0
    const manager = createMcpClientManager({
      connect: async (server) => {
        if (server.name === 'bad') {
          return makeResourceClient(async () => {
            badCalls += 1
            return {
              resources: [{ uri: `bad://page-${badCalls}`, name: `bad-${badCalls}` }],
              nextCursor: 'repeated',
            }
          })
        }
        return makeResourceClient(async () => ({
          resources: [{ uri: 'good://resource', name: 'good' }],
        }))
      },
    })

    const resources = await manager.listResources(
      [makeServer({ id: 'bad', name: 'bad' }), makeServer({ id: 'good', name: 'good' })],
      '/tmp',
    )

    expect(badCalls).toBe(2)
    expect(resources).toEqual([{ server: 'good', uri: 'good://resource', name: 'good' }])
  })

  test('unique cursors are still bounded to 100 pages per server', async () => {
    let calls = 0
    const manager = createMcpClientManager({
      connect: async () =>
        makeResourceClient(async () => {
          calls += 1
          return {
            resources: [{ uri: `resource://page-${calls}`, name: `page-${calls}` }],
            nextCursor: `page-${calls + 1}`,
          }
        }),
    })

    const resources = await manager.listResources([makeServer()], '/tmp')

    expect(calls).toBe(100)
    expect(resources).toEqual([])
  })

  test('a single oversized page cannot exceed the aggregate item ceiling', async () => {
    const manager = createMcpClientManager({
      connect: async () =>
        makeResourceClient(async () => ({
          resources: Array.from({ length: 10_001 }, (_, index) => ({
            uri: `resource://${index}`,
            name: `resource-${index}`,
          })),
        })),
    })

    expect(await manager.listResources([makeServer()], '/tmp')).toEqual([])
  })

  test('preserves SDK resource annotations and metadata', async () => {
    const manager = createMcpClientManager({
      connect: async () =>
        makeResourceClient(async () => ({
          resources: [
            {
              uri: 'resource://annotated',
              name: 'Annotated',
              title: 'Annotated resource',
              size: 42,
              annotations: {
                audience: ['assistant'],
                priority: 0.9,
                lastModified: '2026-07-22T00:00:00.000Z',
              },
              _meta: { origin: 'test' },
            },
          ],
        })),
    })

    expect(await manager.listResources([makeServer()], '/tmp')).toEqual([
      {
        server: 'alpha',
        uri: 'resource://annotated',
        name: 'Annotated',
        title: 'Annotated resource',
        size: 42,
        annotations: {
          audience: ['assistant'],
          priority: 0.9,
          lastModified: '2026-07-22T00:00:00.000Z',
        },
        _meta: { origin: 'test' },
      },
    ])
  })
})

describe('resources/templates/list enumeration', () => {
  test('follows opaque cursors and preserves template annotations', async () => {
    const seenParams: Array<{ cursor?: string } | undefined> = []
    const manager = createMcpClientManager({
      connect: async () =>
        makeResourceTemplateClient(async (params) => {
          seenParams.push(params)
          if (!params) {
            return {
              resourceTemplates: [
                {
                  uriTemplate: 'docs://{slug}',
                  name: 'Docs',
                  annotations: { audience: ['assistant'], priority: 0.7 },
                },
              ],
              nextCursor: 'opaque/page-2',
            }
          }
          return {
            resourceTemplates: [
              {
                uriTemplate: 'issue://{number}',
                name: 'Issue',
                annotations: { lastModified: '2026-07-22T00:00:00.000Z' },
              },
            ],
          }
        }),
    })

    const templates = await manager.listResourceTemplates([makeServer()], '/tmp')

    expect(seenParams).toEqual([undefined, { cursor: 'opaque/page-2' }])
    expect(templates).toEqual([
      {
        server: 'alpha',
        uriTemplate: 'docs://{slug}',
        name: 'Docs',
        annotations: { audience: ['assistant'], priority: 0.7 },
      },
      {
        server: 'alpha',
        uriTemplate: 'issue://{number}',
        name: 'Issue',
        annotations: { lastModified: '2026-07-22T00:00:00.000Z' },
      },
    ])
  })

  test('a repeated cursor drops only the failing template server', async () => {
    let badCalls = 0
    const manager = createMcpClientManager({
      connect: async (server) => {
        if (server.name === 'bad') {
          return makeResourceTemplateClient(async () => {
            badCalls += 1
            return {
              resourceTemplates: [{ uriTemplate: 'bad://{id}', name: 'Bad' }],
              nextCursor: 'repeat',
            }
          })
        }
        return makeResourceTemplateClient(async () => ({
          resourceTemplates: [{ uriTemplate: 'good://{id}', name: 'Good' }],
        }))
      },
    })

    const templates = await manager.listResourceTemplates(
      [makeServer({ name: 'bad' }), makeServer({ name: 'good' })],
      '/tmp',
    )

    expect(badCalls).toBe(2)
    expect(templates).toEqual([{ server: 'good', uriTemplate: 'good://{id}', name: 'Good' }])
  })
})

describe('isTransportError', () => {
  test('recognises the SDK connection-closed code and socket errnos in the cause chain', () => {
    expect(isTransportError(new McpError(ErrorCode.ConnectionClosed, 'Connection closed'))).toBe(
      true,
    )
    const refused = Object.assign(new Error('connect failed'), { code: 'ECONNREFUSED' })
    expect(isTransportError(new TypeError('fetch failed', { cause: refused }))).toBe(true)
    expect(isTransportError(new Error('Not connected'))).toBe(true)
  })

  test('a tool failure that merely mentions a connection keeps the client', () => {
    expect(isTransportError(new Error('postgres: connection refused (ECONNREFUSED)'))).toBe(false)
    expect(isTransportError(new McpError(ErrorCode.InvalidParams, 'socket hang up'))).toBe(false)
  })
})
