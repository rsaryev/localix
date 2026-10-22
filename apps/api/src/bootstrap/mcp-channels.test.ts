import { afterEach, describe, expect, test } from 'bun:test'

import { createDatabase } from '../db/connection'
import { migrateToLatest } from '../db/migrator'
import type { HitlRaised } from '../features/attention/sources'
import { createMcpRepository, type McpServerRecord } from '../features/mcp/repository'
import type { PermissionPrompt } from '../features/mcp/mcp-channel-permissions'
import {
  channelServerResolver,
  permissionPromptOf,
  withChannelPermissionRelay,
} from './mcp-channels'

const dbs: Array<ReturnType<typeof createDatabase>> = []
afterEach(async () => void (await Promise.all(dbs.splice(0).map((db) => db.destroy()))))

const confirmCard = (payload: Record<string, unknown>, title = 'Run a command'): HitlRaised => ({
  userId: 'u1',
  sessionId: 'chat-a',
  requestId: 'req-1',
  interaction: {
    messageId: 'm1',
    toolCallId: 'call-1',
    toolName: 'bash',
    request: { requestId: 'req-1', kind: 'confirm', title, payload },
  },
})

describe('approval cards as relayed permission requests', () => {
  test('a shell card relays a summary, never the command, and the command as its preview', () => {
    expect(permissionPromptOf(confirmCard({ command: 'git push', cwd: '/repo' }))).toEqual({
      userId: 'u1',
      sessionId: 'chat-a',
      hostRequestId: 'req-1',
      toolName: 'bash',
      description: 'Run shell command',
      input: { command: 'git push', cwd: '/repo' },
    })
    const read = permissionPromptOf(
      confirmCard({ command: '/repo/.env', subject: 'path' }, 'Read .env'),
    )
    expect(read?.description).toBe('Read .env')
    expect(read?.input).toEqual({ path: '/repo/.env' })
  })

  test('a question that is not an approval is not relayed', () => {
    const ask: HitlRaised = { ...confirmCard({}), interaction: { request: { kind: 'ask' } } }
    expect(permissionPromptOf(ask)).toBeNull()
  })

  test('the lifecycle still reaches attention, and opens and closes the remote request', () => {
    const seen: string[] = []
    const opened: PermissionPrompt[] = []
    const closed: string[] = []
    const observer = withChannelPermissionRelay(
      {
        raised: (request) => seen.push(`raised ${request.requestId}`),
        ended: (ending) => seen.push(`ended ${ending.requestId}`),
      },
      {
        channelPermissionOpened: (...args) => void opened.push(...args),
        channelPermissionClosed: (...args) => void closed.push(...args),
      },
    )
    observer.raised(confirmCard({ command: 'ls' }))
    observer.ended({ userId: 'u1', requestId: 'req-1', reason: 'answered' })
    expect(seen).toEqual(['raised req-1', 'ended req-1'])
    expect(opened.map((prompt) => prompt.hostRequestId)).toEqual(['req-1'])
    expect(closed).toEqual(['req-1'])
  })
})

describe('kept channel bindings at boot', () => {
  async function fixture() {
    const db = createDatabase()
    dbs.push(db)
    await migrateToLatest(db)
    const repo = createMcpRepository(db)
    const add = (name: string, config: Record<string, unknown>) =>
      repo.upsert({
        id: name,
        userId: 'u1',
        projectId: '',
        name,
        description: '',
        transport: 'stdio',
        config: { command: ['x'], ...config },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      })
    return { db, add }
  }
  const binding = (serverId: string) => ({
    userId: 'u1',
    serverId,
    cwd: '/repo',
    projectId: '',
    scope: 'u1::/repo',
    sessionId: 'chat-a',
  })

  test('a server the person added starts again only while it is opted in as a channel', async () => {
    const { db, add } = await fixture()
    await add('opted', { channel: true })
    await add('plain', {})
    const resolve = channelServerResolver(db, async () => [])
    expect((await resolve(binding('opted')))?.name).toBe('opted')
    expect(await resolve(binding('plain'))).toBeNull()
    expect(await resolve(binding('missing'))).toBeNull()
  })

  test('a plugin server resolves from its scope’s enabled plugins', async () => {
    const { db } = await fixture()
    const plugin: McpServerRecord = {
      id: 'plugin:chat:chat',
      userId: 'u1',
      projectId: '',
      name: 'chat_chat',
      description: '',
      transport: 'stdio',
      config: { command: ['x'] },
      createdAt: '',
      updatedAt: '',
    }
    const scopes: string[] = []
    const resolve = channelServerResolver(db, async (opts) => {
      scopes.push(`${opts.projectId}:${opts.cwd}`)
      return [plugin]
    })
    expect(await resolve(binding('plugin:chat:chat'))).toBe(plugin)
    expect(await resolve(binding('plugin:gone:chat'))).toBeNull()
    expect(scopes).toEqual([':/repo', ':/repo'])
  })
})
