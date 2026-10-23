import { describe, expect, test } from 'bun:test'

import { createMcpClientManager } from './client-manager'
import type { McpClientLike } from './mcp-wire'
import type { McpServerRecord } from './repository'

/**
 * The anti-drift suite.
 *
 * `cachedToolNames` is a SECOND reader of the "what does this scope put on the wire" question,
 * and the first one (`gather`) is authoritative. Every test here is the same assertion in a
 * different configuration: the two must produce identical names. A cheap estimate that quietly
 * disagrees with the roster is worse than no estimate — it is the classic shipped failure of
 * this feature: a surface that reports "128 tools" while the picker lists 118.
 */

const CWD = '/tmp'
const GATHER = { cwd: CWD, scope: 'user-1:' }

function server(over: Partial<McpServerRecord> = {}): McpServerRecord {
  return {
    id: 'srv-1',
    userId: 'user-1',
    projectId: '',
    name: 'alpha',
    description: '',
    transport: 'stdio',
    config: { command: ['fake-server'] },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }
}

function client(toolNames: string[]): McpClientLike {
  return {
    onclose: undefined,
    async listTools() {
      return {
        tools: toolNames.map((name) => ({
          name,
          description: `${name} tool`,
          inputSchema: { type: 'object', properties: {} },
        })),
      }
    },
    async callTool() {
      return { content: [{ type: 'text', text: 'ok' }], isError: false }
    },
    async close() {},
  }
}

/** Connect handler that gives each server the tool list registered for its name. */
function connectWith(toolsByServer: Record<string, string[]>) {
  return async (record: McpServerRecord) => client(toolsByServer[record.name] ?? [])
}

const flat = (report: ReturnType<ReturnType<typeof createMcpClientManager>['cachedToolNames']>) =>
  report.servers.flatMap((entry) => entry.tools)

describe('cachedToolNames agrees with gather', () => {
  test('one server: the estimate is exactly the roster', async () => {
    const manager = createMcpClientManager({ connect: connectWith({ alpha: ['echo', 'ping'] }) })
    const servers = [server()]

    const gathered = await manager.gather(servers, GATHER)
    const cached = manager.cachedToolNames(servers, CWD)

    expect(flat(cached)).toEqual(gathered.tools.map((tool) => tool.name))
    expect(cached.unprobed).toEqual([])
  })

  test('a namespaced-name collision disambiguates identically on both paths', async () => {
    // `git-hub` and `git_hub` both sanitize to `mcp_git_hub_*`. gather appends a numeric suffix
    // to the loser; an estimate that skipped that step would report a name the model never sees.
    const manager = createMcpClientManager({
      connect: connectWith({ 'git-hub': ['issue'], git_hub: ['issue'] }),
    })
    const servers = [
      server({ id: 'srv-a', name: 'git-hub' }),
      server({ id: 'srv-b', name: 'git_hub' }),
    ]

    const gathered = await manager.gather(servers, GATHER)
    const cached = manager.cachedToolNames(servers, CWD)

    const names = gathered.tools.map((tool) => tool.name)
    expect(new Set(names).size).toBe(2)
    expect(flat(cached)).toEqual(names)
  })

  test('per-tool policy is applied on both paths', async () => {
    const manager = createMcpClientManager({
      connect: connectWith({ alpha: ['keep', 'drop'] }),
    })
    const servers = [server({ config: { command: ['fake-server'] } })]
    const toolPolicy = (_serverName: string, toolName: string) => toolName !== 'drop'

    const gathered = await manager.gather(servers, { ...GATHER, toolPolicy })
    const cached = manager.cachedToolNames(servers, CWD, toolPolicy)

    expect(flat(cached)).toEqual(gathered.tools.map((tool) => tool.name))
    expect(flat(cached).some((name) => name.endsWith('drop'))).toBe(false)
  })

  /**
   * The count the screen shows is the roster the run would send, so the screen has to apply
   * the same rules. Reading them on one path only is how "128 tools" came to sit above a
   * list of 118.
   */
  test('a cached listing without the policy still reports the whole server', async () => {
    const manager = createMcpClientManager({
      connect: connectWith({ alpha: ['keep', 'drop'] }),
    })
    const servers = [server({ config: { command: ['fake-server'] } })]

    await manager.gather(servers, GATHER)

    expect(flat(manager.cachedToolNames(servers, CWD))).toHaveLength(2)
  })

  test('server order decides collisions the same way in both', async () => {
    const manager = createMcpClientManager({
      connect: connectWith({ 'git-hub': ['issue'], git_hub: ['issue'] }),
    })
    const reversed = [
      server({ id: 'srv-b', name: 'git_hub' }),
      server({ id: 'srv-a', name: 'git-hub' }),
    ]

    const gathered = await manager.gather(reversed, GATHER)
    const cached = manager.cachedToolNames(reversed, CWD)

    expect(flat(cached)).toEqual(gathered.tools.map((tool) => tool.name))
  })

  test('a server the caller withheld contributes nothing and is not called unprobed', async () => {
    // Availability is decided before this point now — `resolveMcpTools` filters by the
    // scope's rules — so "disabled" reaches the manager as an absent server.
    const manager = createMcpClientManager({ connect: connectWith({ alpha: ['echo'] }) })
    const servers: ReturnType<typeof server>[] = []

    const gathered = await manager.gather(servers, GATHER)
    const cached = manager.cachedToolNames(servers, CWD)

    expect(gathered.tools).toEqual([])
    expect(cached.servers).toEqual([])
    // Off is not "unknown". Reporting it as unprobed would invite a UI to warn about a server
    // the user deliberately switched off.
    expect(cached.unprobed).toEqual([])
  })
})

describe('cachedToolNames is honest about what it cannot know', () => {
  test('never connects — an unconnected server is NAMED, not counted as zero', async () => {
    let connects = 0
    const manager = createMcpClientManager({
      connect: async () => {
        connects += 1
        return client(['echo'])
      },
    })

    const cached = manager.cachedToolNames([server({ name: 'alpha' })], CWD)

    expect(connects).toBe(0)
    expect(cached.servers).toEqual([])
    expect(cached.unprobed).toEqual(['alpha'])
  })

  test('a partially warm scope reports both halves', async () => {
    const manager = createMcpClientManager({
      connect: connectWith({ alpha: ['echo'], beta: ['search'] }),
    })
    const alpha = server({ id: 'srv-a', name: 'alpha' })
    const beta = server({ id: 'srv-b', name: 'beta' })

    // Only alpha has ever been gathered.
    await manager.gather([alpha], GATHER)
    const cached = manager.cachedToolNames([alpha, beta], CWD)

    expect(cached.servers.map((entry) => entry.serverName)).toEqual(['alpha'])
    expect(cached.unprobed).toEqual(['beta'])
  })

  test('a changed config invalidates the estimate rather than reusing a stale listing', async () => {
    const manager = createMcpClientManager({ connect: connectWith({ alpha: ['echo'] }) })
    const original = server()
    await manager.gather([original], GATHER)
    expect(manager.cachedToolNames([original], CWD).unprobed).toEqual([])

    // Same server row, different command — a different cache key, so the warm entry describes a
    // process this config would not start.
    const edited = server({ config: { command: ['other-server'] } })
    expect(manager.cachedToolNames([edited], CWD).unprobed).toEqual(['alpha'])
  })

  test('carries the server id, so a suggestion can route to the right settings page', async () => {
    const manager = createMcpClientManager({ connect: connectWith({ alpha: ['echo'] }) })
    const servers = [server({ id: 'srv-linear', name: 'alpha' })]
    await manager.gather(servers, GATHER)

    expect(manager.cachedToolNames(servers, CWD).servers[0]).toMatchObject({
      serverId: 'srv-linear',
      serverName: 'alpha',
    })
  })
})
