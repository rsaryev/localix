import { describe, expect, test } from 'bun:test'

import { createMcpClientManager, type McpClientLike } from './client-manager'
import {
  CHANNEL_NOTIFICATION,
  channelEvent,
  formatChannelMessage,
  type ChannelDelivery,
} from './mcp-channels'
import type { McpServerRecord } from './repository'

const server = (id: string, name: string): McpServerRecord => ({
  id,
  userId: 'user-1',
  projectId: '',
  name,
  description: '',
  transport: 'stdio',
  config: { command: ['fake-channel'] },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
})

/** A connected client whose server may declare the channel capability. */
function channelClient(channel: boolean): McpClientLike {
  return {
    async listTools() {
      return { tools: [{ name: 'reply', inputSchema: { type: 'object', properties: {} } }] }
    },
    async callTool() {
      return { content: [] }
    },
    async close() {},
    getServerCapabilities: () =>
      channel ? { tools: {}, experimental: { 'claude/channel': {} } } : { tools: {} },
  } as McpClientLike
}

function setup(clients: Record<string, McpClientLike>) {
  const manager = createMcpClientManager({ connect: async (record) => clients[record.id]! })
  const delivered: ChannelDelivery[] = []
  manager.deliverChannelEvents((delivery) => delivered.push(delivery))
  const push = (id: string, params: unknown) =>
    clients[id]!.fallbackNotificationHandler?.({
      method: CHANNEL_NOTIFICATION,
      params: params as { [key: string]: unknown },
    })
  return { manager, delivered, push }
}

const gather = (
  manager: ReturnType<typeof createMcpClientManager>,
  servers: McpServerRecord[],
  sessionId?: string,
) =>
  manager.gather(servers, {
    cwd: '/repo',
    scope: 'user-1::/repo',
    ...(sessionId ? { channelTarget: { userId: 'user-1', sessionId } } : {}),
  })

describe('Claude Code channels', () => {
  test('a plugin channel’s event becomes a <channel> message for the chat that gathered it', async () => {
    const { manager, delivered, push } = setup({ 'plugin:fakechat:fakechat': channelClient(true) })
    const fakechat = server('plugin:fakechat:fakechat', 'fakechat_fakechat')
    await gather(manager, [fakechat], 'chat-a')
    await push('plugin:fakechat:fakechat', {
      content: 'hello',
      meta: { chat_id: 'web', 'bad-key': 'dropped', n: 1 },
    })
    expect(delivered).toEqual([
      {
        userId: 'user-1',
        sessionId: 'chat-a',
        serverId: 'plugin:fakechat:fakechat',
        content: '<channel source="plugin:fakechat:fakechat" chat_id="web">\nhello\n</channel>',
      },
    ])
  })

  test('events follow the conversation that most recently gathered the server', async () => {
    const { manager, delivered, push } = setup({ 'plugin:p:chat': channelClient(true) })
    const record = server('plugin:p:chat', 'p_chat')
    await gather(manager, [record], 'chat-a')
    await gather(manager, [record], 'chat-b')
    // A gather that is no chat's (a child's, a probe) does not take the channel away.
    await gather(manager, [record])
    await push('plugin:p:chat', { content: 'ping' })
    expect(delivered.map((entry) => entry.sessionId)).toEqual(['chat-b'])
  })

  test('only a plugin server that declares the capability is heard', async () => {
    const clients = {
      'plugin:p:plain': channelClient(false),
      'user-server': channelClient(true),
    }
    const { manager, delivered } = setup(clients)
    await gather(manager, [server('plugin:p:plain', 'p_plain'), server('user-server', 'mine')], 'c')
    expect(clients['plugin:p:plain'].fallbackNotificationHandler).toBeUndefined()
    expect(clients['user-server'].fallbackNotificationHandler).toBeUndefined()
    expect(delivered).toEqual([])
  })

  test('a server the person added is heard once they opt it in as a channel', async () => {
    const clients = { mine: channelClient(true), 'mine-too': channelClient(true) }
    const { manager, delivered, push } = setup(clients)
    const optedIn = { ...server('mine', 'mine'), config: { command: ['x'], channel: true } }
    await gather(manager, [optedIn, server('mine-too', 'mine_too')], 'chat-a')
    expect(clients['mine-too'].fallbackNotificationHandler).toBeUndefined()
    await push('mine', { content: 'from my server' })
    expect(delivered).toEqual([
      {
        userId: 'user-1',
        sessionId: 'chat-a',
        serverId: 'mine',
        content: '<channel source="mine">\nfrom my server\n</channel>',
      },
    ])
  })

  test('an event with no chat bound, or without text, reaches nobody', async () => {
    const { manager, delivered, push } = setup({ 'plugin:p:chat': channelClient(true) })
    await gather(manager, [server('plugin:p:chat', 'p_chat')])
    await push('plugin:p:chat', { content: 'too early' })
    await gather(manager, [server('plugin:p:chat', 'p_chat')], 'chat-a')
    await push('plugin:p:chat', { meta: { chat_id: 'web' } })
    expect(delivered).toEqual([])
  })
})

describe('the <channel> message', () => {
  test('escapes attribute values and keeps only identifier keys with string values', () => {
    const event = channelEvent({ content: 'a <b>', meta: { who: 'x"y<z>', 'x-y': 'no' } })
    expect(event).toEqual({ content: 'a <b>', meta: { who: 'x"y<z>' } })
    expect(formatChannelMessage('plugin:t:t', event!)).toBe(
      '<channel source="plugin:t:t" who="x&quot;y&lt;z&gt;">\na <b>\n</channel>',
    )
  })
})
