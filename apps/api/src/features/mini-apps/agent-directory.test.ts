import { describe, expect, test } from 'bun:test'

import { createMiniAppAgentDirectory } from './agent-directory'

const AGENTS = [
  { id: 'builtin:frontend', handle: 'frontend', description: 'Builds UI', enabled: true },
  { id: 'builtin:qa', handle: 'qa', description: null, enabled: true },
  { id: 'agent-off', handle: 'retired', description: 'Switched off', enabled: false },
]

/** One user owns one session in one project; every other (user, session) is unknown. */
function directory() {
  const asked: Array<[string, string | null]> = []
  const agents = createMiniAppAgentDirectory({
    sessionProject: async (userId, sessionId) =>
      userId === 'owner' && sessionId === 'chat-1' ? 'PRJ-1' : undefined,
    listAgents: async (userId, projectId) => {
      asked.push([userId, projectId])
      return AGENTS
    },
  })
  return { agents, asked }
}

describe('mini app agent directory', () => {
  // A name a mini app stores from here (say, a card's assignee) must be one the host would also
  // run: listing a disabled agent hands out an address that delegation then refuses.
  test('lists only enabled agents of the session’s own scope', async () => {
    const { agents, asked } = directory()
    expect(await agents.list('owner', 'chat-1')).toEqual([
      { id: 'builtin:frontend', handle: 'frontend', description: 'Builds UI' },
      { id: 'builtin:qa', handle: 'qa' },
    ])
    expect(asked).toEqual([['owner', 'PRJ-1']])
  })

  test('the person is not an agent: the directory never lists them', async () => {
    const { agents } = directory()
    const listed = await agents.list('owner', 'chat-1')
    expect(listed.some((agent) => agent.id === 'user' || agent.handle === 'human')).toBe(false)
  })

  // The session is resolved through an owner-scoped lookup BEFORE the registry is read: a
  // mini app passing a foreign or deleted session id must be refused, not shown someone's agents.
  test('refuses a session the user does not own, without reading the registry', async () => {
    const { agents, asked } = directory()
    await expect(agents.list('intruder', 'chat-1')).rejects.toThrow('Session not found')
    await expect(agents.list('owner', 'deleted-chat')).rejects.toThrow('Session not found')
    expect(asked).toEqual([])
  })

  test('a session outside any project reads the global scope, not a refusal', async () => {
    const asked: Array<string | null> = []
    const agents = createMiniAppAgentDirectory({
      sessionProject: async () => null,
      listAgents: async (_userId, projectId) => {
        asked.push(projectId)
        return AGENTS
      },
    })
    expect(await agents.list('owner', 'chat-1')).toHaveLength(2)
    expect(asked).toEqual([null])
  })
})
