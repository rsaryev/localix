import { expect, spyOn, test } from 'bun:test'
import { Hono } from 'hono'
import { ApiError } from '../../../lib/errors'
import type { HostRouteContext } from '@localixai/mini-app-sdk/backend'
import { AgentSessionsService } from './service'
import { createOwnedAgentRoutes, type OwnedSessionHost } from './owned-session-routes'

function fixture(overrides: Partial<OwnedSessionHost> = {}, agents?: AgentSessionsService) {
  const spawns: { userId: string; sessionId: string; command: string }[] = []
  const host: OwnedSessionHost = {
    session: async (userId, sessionId) => {
      if (userId !== 'user' || sessionId !== 'our-chat')
        throw new ApiError(404, 'not_found', 'Session not found')
      return { externalAgentProvider: 'codex' }
    },
    cwd: async () => '/work/current-project',
    terminals: () => [],
    spawn: async (userId, sessionId, command) => {
      spawns.push({ userId, sessionId, command })
      return { id: 'pty' }
    },
    remember: async () => {},
    ...overrides,
  }
  const app = new Hono<HostRouteContext>()
    .use('*', async (c, next) => {
      c.set('userId', 'user')
      await next()
    })
    .route(
      '/',
      createOwnedAgentRoutes(host, agents, async () => [
        { id: 'codex', name: 'Codex', command: 'codex' },
      ]),
    )
  const open = (sessionId = 'our-chat') =>
    app.request('/open-owned', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
  return { spawns, open }
}

test('opens the selected CLI inside its own Localix session and rejects foreign owners', async () => {
  const { open, spawns } = fixture()
  expect(await (await open()).json()).toEqual({ terminalId: 'pty', providerName: 'Codex' })
  expect(spawns).toEqual([{ userId: 'user', sessionId: 'our-chat', command: 'codex' }])
  expect((await open('foreign-chat')).status).toBe(404)
  expect(spawns).toHaveLength(1)
})

test('reuses the existing agent terminal, ignoring unrelated programs in the same chat', async () => {
  const { open, spawns } = fixture({
    terminals: () => [
      { id: 'server', chatSessionId: 'our-chat', command: 'bun dev' },
      { id: 'other-chat', chatSessionId: 'another', command: 'codex' },
      { id: 'existing', chatSessionId: 'our-chat', command: 'codex' },
    ],
  })
  expect((await (await open()).json()).terminalId).toBe('existing')
  expect(spawns).toEqual([])
})

test('saved native identity resumes that exact session in the current Localix workspace', async () => {
  const { open, spawns } = fixture({
    session: async () => ({
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:native-session',
    }),
  })
  expect((await open()).status).toBe(200)
  expect(spawns[0]?.command).toBe("codex resume 'native-session'")
  expect(spawns[0]?.command).not.toContain('cd ')
})

test('discovered history continues in its recorded directory and never resumes missing native history', async () => {
  const agents = new AgentSessionsService('/tmp/owned-native-source', () => {}, {
    env: {},
    homeDir: '/tmp/owned-native-source-home',
  })
  const resume = spyOn(agents, 'resume').mockResolvedValue({
    resume: { providerName: 'Codex', command: "cd -- '/work/native' && codex resume 'native'" },
  })
  const metadata = { externalAgentProvider: 'codex', externalAgentSessionKey: 'codex:native' }
  try {
    const first = fixture({ session: async () => metadata }, agents)
    expect((await first.open()).status).toBe(200)
    expect(first.spawns[0]?.command).toBe("cd -- '/work/native' && codex resume 'native'")
    expect(agents.live.get('pty')?.provider).toBe('codex')
    const reused = fixture(
      {
        session: async () => metadata,
        terminals: () => [
          { id: 'pty', chatSessionId: 'our-chat', command: first.spawns[0]?.command },
        ],
      },
      agents,
    )
    expect((await reused.open()).status).toBe(200)
    expect(reused.spawns).toEqual([])
    resume.mockResolvedValue(null)
    const missing = fixture({ session: async () => metadata }, agents)
    expect((await missing.open()).status).toBe(404)
    expect(missing.spawns).toEqual([])
  } finally {
    resume.mockRestore()
    agents.shutdown()
  }
})

test('rejects ordinary chats and incompatible native identities instead of launching a different session', async () => {
  for (const metadata of [
    {},
    { externalAgentProvider: 'codex', externalAgentSessionKey: 'claude-code:foreign' },
  ]) {
    const { open, spawns } = fixture({ session: async () => metadata })
    expect((await open()).status).toBe(metadata.externalAgentProvider ? 409 : 400)
    expect(spawns).toEqual([])
  }
})

test('concurrent openings create a single terminal', async () => {
  const { open, spawns } = fixture()
  const responses = await Promise.all([open(), open()])
  expect(responses.map((response) => response.status)).toEqual([200, 200])
  expect(spawns).toHaveLength(1)
})

test('opening many different sessions retains one terminal per session and reuses each on return', async () => {
  const terminals: { id: string; chatSessionId: string; command: string }[] = []
  const { open } = fixture({
    session: async () => ({ externalAgentProvider: 'codex' }),
    terminals: () => terminals,
    spawn: async (_userId, sessionId, command) => {
      const terminal = { id: `pty-${sessionId}`, chatSessionId: sessionId, command }
      terminals.push(terminal)
      return terminal
    },
  })
  for (let index = 0; index < 40; index++) {
    expect((await open(`chat-${index}`)).status).toBe(200)
  }
  expect(terminals).toHaveLength(40)
  for (let index = 0; index < 40; index++) {
    expect((await (await open(`chat-${index}`)).json()).terminalId).toBe(`pty-chat-${index}`)
  }
  expect(terminals).toHaveLength(40)
})

test('native correlation saves identity on our session, ready for a later resume', async () => {
  const agents = new AgentSessionsService('/tmp/localix-owned-correlation-state', () => {}, {
    env: {},
    homeDir: '/tmp/localix-owned-correlation-home',
  })
  const remember = spyOn(
    { remember: async (_user: string, _session: string, _key: string) => {} },
    'remember',
  )
  try {
    const { open } = fixture({ remember }, agents)
    expect((await open()).status).toBe(200)
    expect(agents.live.get('pty')?.localixSessionId).toBe('our-chat')
    agents.live.adopt('pty', 'native-id')
    await Promise.resolve()
    expect(remember).toHaveBeenCalledWith('user', 'our-chat', 'codex:pending-terminal-pty')
    expect(remember).toHaveBeenCalledWith('user', 'our-chat', 'codex:native-id')
  } finally {
    agents.shutdown()
    remember.mockRestore()
  }
})

test('an uncorrelated closed terminal never silently starts a different native conversation', async () => {
  const { open, spawns } = fixture({
    session: async () => ({
      externalAgentProvider: 'codex',
      externalAgentSessionKey: 'codex:pending-terminal-old',
    }),
  })
  expect((await open()).status).toBe(409)
  expect(spawns).toEqual([])
})
