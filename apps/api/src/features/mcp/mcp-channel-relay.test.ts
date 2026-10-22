import { describe, expect, test } from 'bun:test'

import { createMcpClientManager, type McpClientLike } from './client-manager'
import {
  CHANNEL_NOTIFICATION,
  type ChannelBinding,
  type ChannelBindingStore,
  type ChannelDelivery,
} from './mcp-channels'
import {
  PERMISSION_REQUEST,
  PERMISSION_VERDICT,
  type PermissionPrompt,
} from './mcp-channel-permissions'
import type { McpServerRecord } from './repository'

const record = (id: string, config: Record<string, unknown> = {}): McpServerRecord => ({
  id,
  userId: 'user-1',
  projectId: '',
  name: id.replace(/\W/g, '_'),
  description: '',
  transport: 'stdio',
  config: { command: ['fake'], ...config },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

type Sent = { method: string; params?: Record<string, unknown> }

/** A connected client whose server declares `experimental` capabilities as given. */
function fakeClient(experimental: Record<string, unknown>): McpClientLike & { sent: Sent[] } {
  const sent: Sent[] = []
  return {
    sent,
    async listTools() {
      return { tools: [{ name: 'reply', inputSchema: { type: 'object', properties: {} } }] }
    },
    async callTool() {
      return { content: [] }
    },
    async close() {},
    getServerCapabilities: () => ({ experimental }),
    async notification(notification) {
      sent.push(notification)
    },
  } as McpClientLike & { sent: Sent[] }
}

function memoryStore(rows: ChannelBinding[] = []) {
  const saved: ChannelBinding[] = []
  const removed: string[] = []
  const store: ChannelBindingStore = {
    async save(binding) {
      saved.push(binding)
    },
    async list() {
      return rows
    },
    async remove(binding) {
      removed.push(binding.serverId)
    },
  }
  return { store, saved, removed }
}

const RELAY = { 'claude/channel': {}, 'claude/channel/permission': {} }

function setup(clients: Record<string, ReturnType<typeof fakeClient>>) {
  // A fixed letter sequence, so request ids are known: `aaaaa`, then the next.
  let draws = 0
  const manager = createMcpClientManager({
    connect: async (server) => clients[server.id]!,
    random: () => Math.floor(draws++ / 5) / 25,
  })
  const answers: Array<{ hostRequestId: string; allow: boolean }> = []
  manager.answerChannelPermissions(({ hostRequestId, allow }) => {
    answers.push({ hostRequestId, allow })
  })
  return { manager, answers }
}

const gather = (
  manager: ReturnType<typeof createMcpClientManager>,
  servers: McpServerRecord[],
  sessionId: string,
) =>
  manager.gather(servers, {
    cwd: '/repo',
    scope: 'user-1::/repo',
    channelTarget: { userId: 'user-1', sessionId, projectId: '' },
  })

const prompt = (hostRequestId: string, sessionId = 'chat-a'): PermissionPrompt => ({
  userId: 'user-1',
  sessionId,
  hostRequestId,
  toolName: 'bash',
  description: 'Run shell command',
  input: { command: 'git   push\n--force', cwd: '/repo' },
})

const verdict = (client: McpClientLike, params: Record<string, unknown>) =>
  client.fallbackNotificationHandler?.({ method: PERMISSION_VERDICT, params })

describe('channel permission relay', () => {
  test('a card in the bound chat reaches a relay channel, and its verdict answers the card', async () => {
    const relay = fakeClient(RELAY)
    const { manager, answers } = setup({ 'plugin:chat:chat': relay })
    await gather(manager, [record('plugin:chat:chat')], 'chat-a')
    manager.channelPermissionOpened(prompt('host-1'))
    expect(relay.sent).toEqual([
      {
        method: PERMISSION_REQUEST,
        params: {
          request_id: 'aaaaa',
          tool_name: 'bash',
          description: 'Run shell command',
          input_preview: '{"command":"git push --force","cwd":"/repo"}',
        },
      },
    ])
    await verdict(relay, { request_id: 'aaaaa', behavior: 'allow' })
    expect(answers).toEqual([{ hostRequestId: 'host-1', allow: true }])
    // Answered once: the same verdict again settles nothing.
    await verdict(relay, { request_id: 'aaaaa', behavior: 'deny' })
    expect(answers).toHaveLength(1)
  })

  test('a card answered here first drops the remote request; unknown ids are ignored', async () => {
    const relay = fakeClient(RELAY)
    const { manager, answers } = setup({ 'plugin:chat:chat': relay })
    await gather(manager, [record('plugin:chat:chat')], 'chat-a')
    manager.channelPermissionOpened(prompt('host-1'))
    manager.channelPermissionClosed('host-1')
    await verdict(relay, { request_id: 'aaaaa', behavior: 'allow' })
    await verdict(relay, { request_id: 'zzzzz', behavior: 'allow' })
    await verdict(relay, { request_id: 'aaaaa', behavior: 'maybe' })
    expect(answers).toEqual([])
  })

  test('only a channel that declared the relay, bound to that chat, hears or answers', async () => {
    const relay = fakeClient(RELAY)
    const optedOut = fakeClient({ 'claude/channel': {}, 'claude/channel/permission': false })
    const elsewhere = fakeClient(RELAY)
    const { manager, answers } = setup({
      'plugin:a:relay': relay,
      'plugin:a:quiet': optedOut,
      'plugin:b:elsewhere': elsewhere,
    })
    await gather(manager, [record('plugin:a:relay'), record('plugin:a:quiet')], 'chat-a')
    await manager.gather([record('plugin:b:elsewhere')], {
      cwd: '/other',
      scope: 'user-1::/other',
      channelTarget: { userId: 'user-1', sessionId: 'chat-b' },
    })
    manager.channelPermissionOpened(prompt('host-1'))
    expect(relay.sent).toHaveLength(1)
    expect(optedOut.sent).toEqual([])
    expect(elsewhere.sent).toEqual([])
    // A channel the request was not sent to cannot answer it, even with the right id.
    await verdict(elsewhere, { request_id: 'aaaaa', behavior: 'allow' })
    await verdict(optedOut, { request_id: 'aaaaa', behavior: 'allow' })
    expect(answers).toEqual([])
  })
})

describe('kept channel bindings', () => {
  test('a chat binding a channel is kept once, and again when another chat takes it', async () => {
    const { manager } = setup({
      'plugin:chat:chat': fakeClient(RELAY),
      'plugin:plain:tools': fakeClient({}),
    })
    const { store, saved } = memoryStore()
    manager.keepChannelBindings(store, () => '2026-10-01T00:00:00.000Z')
    const servers = [record('plugin:chat:chat'), record('plugin:plain:tools')]
    await gather(manager, servers, 'chat-a')
    await gather(manager, servers, 'chat-a')
    await gather(manager, servers, 'chat-b')
    expect(saved).toEqual([
      {
        userId: 'user-1',
        sessionId: 'chat-a',
        serverId: 'plugin:chat:chat',
        cwd: '/repo',
        projectId: '',
        scope: 'user-1::/repo',
      },
      {
        userId: 'user-1',
        sessionId: 'chat-b',
        serverId: 'plugin:chat:chat',
        cwd: '/repo',
        projectId: '',
        scope: 'user-1::/repo',
      },
    ])
  })

  test('after a restart a kept channel starts again and speaks into its chat before any turn', async () => {
    const channel = fakeClient({ 'claude/channel': {} })
    const { manager } = setup({ 'plugin:chat:chat': channel })
    const delivered: ChannelDelivery[] = []
    manager.deliverChannelEvents((delivery) => delivered.push(delivery))
    const kept: ChannelBinding = {
      userId: 'user-1',
      sessionId: 'chat-a',
      serverId: 'plugin:chat:chat',
      cwd: '/repo',
      projectId: '',
      scope: 'user-1::/repo',
    }
    const gone = { ...kept, serverId: 'plugin:removed:chat' }
    const { store, saved, removed } = memoryStore([kept, gone])
    manager.keepChannelBindings(store)
    const started = await manager.restoreChannels(store, async (binding) =>
      binding.serverId === kept.serverId ? record(kept.serverId) : null,
    )
    expect(started).toBe(1)
    expect(removed).toEqual(['plugin:removed:chat'])
    await channel.fallbackNotificationHandler?.({
      method: CHANNEL_NOTIFICATION,
      params: { content: 'after restart' },
    })
    expect(delivered.map((entry) => [entry.sessionId, entry.content])).toEqual([
      ['chat-a', '<channel source="plugin:chat:chat">\nafter restart\n</channel>'],
    ])
    // Read back, not rewritten.
    expect(saved).toEqual([])
  })
})
