import { describe, expect, test } from 'bun:test'

import { createChannelWorkspace, type ChannelWorkspaceDeps } from './channel-workspace'

type ChatService = ChannelWorkspaceDeps['chatService']
type RawSession = NonNullable<Awaited<ReturnType<ChatService['getChatSessionProjection']>>>

const session = (
  id: string,
  sessionKind: string,
  overrides: Partial<RawSession> = {},
): RawSession => ({
  id,
  sessionKind,
  title: id,
  projectId: 'PRJ-test',
  runtimeStatus: 'idle',
  modelId: 'model-owned',
  reasoningEffort: 'low',
  updatedAt: '2026-07-22T00:00:00.000Z',
  providerConnectionId: 'connection-owned',
  ...overrides,
})

function harness() {
  const sessions = new Map<string, RawSession>([
    ['chat', session('chat', 'chat')],
    ['system', session('system', 'system', { modelId: 'model-system' })],
    ['subagent', session('subagent', 'subagent')],
    ['job', session('job', 'job')],
  ])
  const updates: Array<{ userId: string; sessionId: string; patch: unknown }> = []
  const stops: Array<{ sessionId: string; userId?: string }> = []
  const interactions: Array<{
    requestId: string
    action: string
    payload: unknown
    userId?: string
  }> = []
  const creates: unknown[] = []
  const reads = { fullRosters: 0, recentChats: 0, pointChats: 0 }
  const requestSessions = new Map([
    ['request-chat', 'chat'],
    ['request-system', 'system'],
    ['request-foreign', 'foreign'],
  ])

  const chatService: ChatService = {
    async listRecentChatSessions(userId, opts) {
      expect(userId).toBe('owner')
      reads.recentChats += 1
      return [...sessions.values()]
        .filter(
          (candidate) =>
            candidate.sessionKind === 'chat' &&
            (opts?.projectId === undefined || candidate.projectId === opts.projectId),
        )
        .slice(0, opts?.limit ?? 20)
    },
    async getChatSessionProjection(userId, sessionId) {
      expect(userId).toBe('owner')
      reads.pointChats += 1
      const candidate = sessions.get(sessionId)
      return candidate?.sessionKind === 'chat' ? candidate : null
    },
    async createSession(userId, input) {
      expect(userId).toBe('owner')
      creates.push(input)
      const created = session('created', 'chat', {
        title: input.title ?? 'created',
        projectId: input.projectId ?? 'PRJ-test',
        providerConnectionId: input.providerConnectionId,
        modelId: input.modelId ?? '',
      })
      // The service returns the session with its party; the channel flattens the one
      // participant a private chat has into the model it speaks about.
      const { modelId, reasoningEffort, providerConnectionId, ...rest } = created
      return {
        ...rest,
        agents: [
          {
            agentId: 'builtin:localix',
            handle: 'localix',
            providerConnectionId: providerConnectionId ?? null,
            modelId,
            reasoningEffort,
          },
        ],
      }
    },
    async stop(sessionId, userId) {
      stops.push({ sessionId, userId })
      return true
    },
    async updateSession(userId, sessionId, patch) {
      updates.push({ userId, sessionId, patch })
    },
    async sessionUsageText(userId, sessionId) {
      return `${userId}:${sessionId}`
    },
    getPendingInteractionSessionId(requestId) {
      return requestSessions.get(requestId) ?? null
    },
    interact(requestId, action, payload, userId) {
      interactions.push({ requestId, action, payload, userId })
      return { ok: true }
    },
  }
  const workspace = createChannelWorkspace({
    userId: 'owner',
    chatService,
    projectsService: {
      async listProjects(userId) {
        expect(userId).toBe('owner')
        return { projects: [{ id: 'project-owned', name: 'Owned' }] }
      },
    },
    catalogService: {
      async getCatalog() {
        return {
          models: [
            { id: 'model-owned', providerId: 'provider-owned' },
            { id: 'model-foreign', providerId: 'provider-foreign' },
          ],
        }
      },
    },
    providerConnectionsService: {
      async listConnections(userId) {
        expect(userId).toBe('owner')
        return {
          connections: [{ id: 'connection-owned', providerId: 'provider-owned' }],
        }
      },
    },
  })
  return { workspace, sessions, updates, stops, interactions, creates, reads }
}

describe('channel workspace session boundary', () => {
  test('lists and reads only regular chats through the host user scope', async () => {
    const { workspace, reads } = harness()

    expect((await workspace.listSessions()).map(({ id }) => id)).toEqual(['chat'])
    expect(await workspace.getSession('chat')).toMatchObject({ id: 'chat' })
    expect(await workspace.getSession('system')).toBeNull()
    expect(await workspace.getSession('subagent')).toBeNull()
    expect(await workspace.getSession('foreign')).toBeNull()
    expect(reads).toEqual({ fullRosters: 0, recentChats: 1, pointChats: 4 })
  })

  test('blocks every session mutation and usage read outside regular chats', async () => {
    const { workspace, updates, stops } = harness()

    expect(await workspace.stopSession('system')).toBe(false)
    expect(workspace.setSessionReasoning('subagent', 'high')).rejects.toThrow(
      'Channel chat session not found',
    )
    expect(workspace.getSessionUsage('system')).rejects.toThrow('Channel chat session not found')
    expect(updates).toEqual([])
    expect(stops).toEqual([])

    await workspace.setSessionReasoning('chat', 'medium')
    expect(await workspace.stopSession('chat')).toBe(true)
    // Under `route`, not flat: the model and effort belong to a PARTICIPANT. This port used to
    // declare them flat and the chat service silently ignored them, so the operation was a
    // no-op — a mismatch only the type system could have caught, and it did not until the
    // shapes stopped sharing an unrelated field.
    expect(updates).toEqual([
      { userId: 'owner', sessionId: 'chat', patch: { route: { reasoningEffort: 'medium' } } },
    ])
    expect(stops).toEqual([{ sessionId: 'chat', userId: 'owner' }])
  })

  test('validates project and provider-connection ownership before mutation', async () => {
    const { workspace, creates, updates, reads } = harness()

    expect(workspace.createSession({ title: 'No', projectId: 'project-foreign' })).rejects.toThrow(
      'Channel project not found',
    )
    expect(creates).toEqual([])

    await workspace.createSession({ title: 'Yes', projectId: 'project-owned' })
    // NEITHER a model nor a connection is stated. A channel-created chat is an ordinary chat and
    // takes the ordinary answer — the project's default, the route this agent was last on, its
    // card — resolved on read (`agent-route-resolution.ts`). It used to copy whatever a previous
    // chat happened to run on, which froze an inbound conversation onto that day's model and
    // needed a `getRecentProviderModel` read of its own; the chain is that read, done properly.
    expect(creates).toEqual([{ title: 'Yes', projectId: 'project-owned' }])
    expect(reads).toEqual({ fullRosters: 0, recentChats: 0, pointChats: 0 })

    expect(
      workspace.setSessionModel('chat', {
        connectionId: 'connection-foreign',
        modelId: 'model-foreign',
      }),
    ).rejects.toThrow('Channel model connection not found')
    expect(updates).toEqual([])

    await workspace.setSessionModel('chat', {
      connectionId: 'connection-owned',
      modelId: 'model-owned',
    })
    expect(updates).toEqual([
      {
        userId: 'owner',
        sessionId: 'chat',
        patch: { route: { providerConnectionId: 'connection-owned', modelId: 'model-owned' } },
      },
    ])
  })

  test('allows HITL control only for an owned regular chat request', async () => {
    const { workspace, interactions } = harness()

    expect(await workspace.respondHitl('request-system', ['no'])).toEqual({
      ok: false,
      error: 'HITL request is no longer active',
    })
    expect(await workspace.dismissHitl('request-foreign')).toEqual({
      ok: false,
      error: 'HITL request is no longer active',
    })
    expect(await workspace.respondHitl('request-missing', [])).toEqual({
      ok: false,
      error: 'HITL request is no longer active',
    })
    expect(interactions).toEqual([])

    expect(await workspace.respondHitl('request-chat', ['yes'])).toEqual({ ok: true })
    expect(interactions).toEqual([
      {
        requestId: 'request-chat',
        action: 'respond',
        payload: { answers: ['yes'] },
        userId: 'owner',
      },
    ])
  })
})
