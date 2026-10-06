import { expect, test } from 'bun:test'
import { Hono } from 'hono'
import type { HostRouteContext } from '@localixai/plugin-sdk/backend'
import { createAttachAgentRoutes, type AttachSessionHost } from './attach-session-routes'

function fixture(cwd: string | undefined = '/work/project/child') {
  const created: Parameters<AttachSessionHost['create']>[1][] = []
  const users: string[] = []
  const records = new Map<
    string,
    { id: string; projectId: string; externalAgentSessionKey: string }[]
  >()
  const host: AttachSessionHost = {
    native: async (key) =>
      key === 'codex:native'
        ? {
            key,
            provider: 'codex',
            nativeSessionId: 'native',
            title: 'Existing review',
            cwd,
            updatedAt: 100,
            sourcePath: '/history/native.jsonl',
          }
        : null,
    sessions: async (user) => ({ sessions: records.get(user) ?? [] }),
    project: async (_user, id) => ({ id, workingDir: '/work/project' }),
    resolveProject: async () => ({ id: 'resolved-project' }),
    create: async (user, input) => {
      created.push(input)
      users.push(user)
      const session = {
        id: `chat-${created.length}`,
        projectId: input.projectId ?? 'default',
        externalAgentSessionKey: input.externalAgentSessionKey,
      }
      records.set(user, [...(records.get(user) ?? []), session])
      return session
    },
  }
  const app = new Hono<HostRouteContext>()
    .use('*', async (c, next) => {
      c.set('userId', c.req.header('x-test-user') ?? 'user')
      await next()
    })
    .route('/', createAttachAgentRoutes(host))
  const attach = (key = 'codex:native', projectId: string | null = 'selected', user = 'user') =>
    app.request('/attach-native', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-test-user': user },
      body: JSON.stringify({ key, projectId: projectId ?? undefined }),
    })
  return { attach, created, users }
}

test('attaches only native identity to a normal chat, reusing it across openings', async () => {
  const { attach, created } = fixture()
  const first = await (await attach()).json()
  const second = await (await attach()).json()
  expect(first).toEqual({ sessionId: 'chat-1', projectId: 'selected' })
  expect(second).toEqual(first)
  expect(created).toEqual([
    {
      title: 'Existing review',
      projectId: 'selected',
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native',
    },
  ])
  expect(created[0]).not.toHaveProperty('messages')
})

test('concurrent openings do not create duplicate chats', async () => {
  const { attach, created } = fixture()
  const responses = await Promise.all([attach(), attach(), attach()])
  expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
  expect(created).toHaveLength(1)
})

test('native identity is reused only for the requesting user', async () => {
  const { attach, created, users } = fixture()
  await attach()
  await attach('codex:native', 'selected', 'other-user')
  expect(created).toHaveLength(2)
  expect(users).toEqual(['user', 'other-user'])
})

test('refuses missing sources and sibling directory prefixes before creating a chat', async () => {
  const missing = fixture()
  expect((await missing.attach('codex:missing')).status).toBe(404)
  expect(missing.created).toEqual([])
  const sibling = fixture('/work/project-other')
  expect((await sibling.attach()).status).toBe(400)
  expect(sibling.created).toEqual([])
  const unknownCwd = fixture('')
  expect((await unknownCwd.attach()).status).toBe(400)
  expect(unknownCwd.created).toEqual([])
})

test('an app-level opening resolves the native directory as its normal project', async () => {
  const { attach, created } = fixture()
  await attach('codex:native', null)
  expect(created[0]?.projectId).toBe('resolved-project')
})
