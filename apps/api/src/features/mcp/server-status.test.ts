import { expect, test } from 'bun:test'

import { createMcpClientManager } from './client-manager'
import type { McpClientLike } from './mcp-wire'
import type { McpServerRecord } from './repository'

const server = (over: Partial<McpServerRecord>): McpServerRecord => ({
  id: 'plugin:kit:echo',
  userId: 'user-1',
  projectId: '',
  name: 'kit_echo',
  description: '',
  transport: 'stdio',
  config: { command: ['fake-server'] },
  createdAt: 'ts',
  updatedAt: 'ts',
  ...over,
})

const working: McpClientLike = {
  async listTools() {
    return { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }
  },
  async callTool() {
    return { content: [] }
  },
  async close() {},
}

test('each server keeps its latest outcome for /mcp, without connecting to read it', async () => {
  let connects = 0
  const manager = createMcpClientManager({
    connect: async (record) => {
      connects += 1
      if (record.name === 'kit_broken') throw new Error('spawn ENOENT')
      return working
    },
  })
  const echo = server({})
  const broken = server({ id: 'plugin:kit:broken', name: 'kit_broken' })
  expect(manager.serverStatus(echo)).toBeUndefined()

  await manager.gather([echo, broken], { cwd: '/tmp', scope: 'user-1::/tmp' })
  const before = connects
  expect(manager.serverStatus(echo)).toMatchObject({ ok: true, toolCount: 1 })
  expect(manager.serverStatus(broken)).toMatchObject({ ok: false, error: 'spawn ENOENT' })
  // A plugin's record id is the same for every user: the status is the asking user's.
  expect(manager.serverStatus({ ...broken, userId: 'user-2' })).toBeUndefined()
  expect(connects).toBe(before)
  await manager.disposeAll()
})

test('a reconnect closes the live client, connects again and updates the outcome /mcp shows', async () => {
  const clients: Array<McpClientLike & { closed: boolean }> = []
  let failNext = false
  const manager = createMcpClientManager({
    connect: async () => {
      if (failNext) throw new Error('refused')
      const client = {
        ...working,
        closed: false,
        async close() {
          client.closed = true
        },
      }
      clients.push(client)
      return client
    },
  })
  const echo = server({})
  await manager.gather([echo], { cwd: '/tmp', scope: 'user-1::/tmp' })
  expect(clients).toHaveLength(1)

  const outcome = await manager.reconnect(echo, '/tmp')
  expect(outcome).toMatchObject({ ok: true, toolCount: 1 })
  expect(clients[0]?.closed).toBe(true)
  expect(clients).toHaveLength(2)
  expect(manager.size()).toBe(1)

  failNext = true
  const failed = await manager.reconnect(echo, '/tmp')
  expect(failed).toMatchObject({ ok: false, error: 'refused' })
  expect(manager.serverStatus(echo)).toMatchObject({ ok: false, error: 'refused' })
  await manager.disposeAll()
})
