import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedParticipants, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'
import { parseParticipants } from './repository-conversation-participants'
import { mergeMessagePayload, type StoredMessagePatch } from '../../db/payload'
import { sessionAgent } from './runtime/message-envelope'
import { deleteSession as deleteSessionWithCleanup } from './service/session-deletion'

describe('session membership persistence', () => {
  let db: ReturnType<typeof createDatabase>
  let repo: ReturnType<typeof createChatRepository>

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    repo = createChatRepository(db)
  })

  afterEach(async () => {
    await destroyDatabase(db)
  })

  test('a child cannot redirect its root away from its parent tree', async () => {
    const parent = sessionFixture({ id: 'parent', seq: 1 })
    const unrelated = sessionFixture({ id: 'unrelated', seq: 2, userId: parent.userId })
    await repo.insertSession(parent)
    await repo.insertSession(unrelated)
    const child = sessionFixture({
      id: 'child',
      seq: 3,
      userId: parent.userId,
      parentSessionId: parent.id,
      rootSessionId: unrelated.id,
    })
    await expect(repo.insertSession(child)).rejects.toThrow('Session root does not match')
    expect(await repo.getSession(parent.userId, child.id)).toBeNull()
  })

  test('an omitted child root is derived before claiming its nested task name', async () => {
    const parent = sessionFixture({ id: 'parent', seq: 1 })
    await repo.insertSession(parent)
    await repo.insertSession(
      sessionFixture({
        id: 'child',
        seq: 2,
        title: 'child',
        userId: parent.userId,
        parentSessionId: parent.id,
        rootSessionId: null,
      }),
    )
    await repo.insertSession(
      sessionFixture({
        id: 'nested',
        seq: 3,
        title: 'nested',
        userId: parent.userId,
        parentSessionId: 'child',
        rootSessionId: null,
      }),
    )
    expect(await repo.getSession(parent.userId, 'nested')).toMatchObject({
      rootSessionId: parent.id,
      taskName: '/root/child/nested',
    })
  })

  test('a child created during cleanup prevents deletion until it is stopped on retry', async () => {
    const parent = sessionFixture({ id: 'parent', seq: 1 })
    await repo.insertSession(parent)
    const stopped: string[] = []
    let addChild = true
    const ctx = {
      repo,
      requireSession: async () => parent,
      runner: {
        withSessionsQuiesced: async <T>(_ids: readonly string[], operation: () => Promise<T>) =>
          operation(),
        stop: async (id: string) => {
          stopped.push(id)
          return true
        },
        forgetSession: async () => {
          if (!addChild) return
          addChild = false
          await repo.insertSession(
            sessionFixture({
              id: 'late-child',
              seq: 2,
              userId: parent.userId,
              parentSessionId: parent.id,
              rootSessionId: parent.id,
            }),
          )
        },
      },
    }
    await expect(deleteSessionWithCleanup(ctx, parent.userId, parent.id)).rejects.toThrow(
      'Session tree changed',
    )
    expect(stopped).toEqual(['parent'])
    expect(await repo.getSession(parent.userId, parent.id)).not.toBeNull()
    expect(await repo.getSession(parent.userId, 'late-child')).not.toBeNull()
    await deleteSessionWithCleanup(ctx, parent.userId, parent.id)
    expect(stopped).toEqual(['parent', 'late-child', 'parent'])
    expect(await repo.getSession(parent.userId, parent.id)).toBeNull()
    expect(await repo.getSession(parent.userId, 'late-child')).toBeNull()
  })

  test('a delayed child insert cannot recreate a deleted parent tree', async () => {
    const parent = sessionFixture({ id: 'parent', seq: 1 })
    await repo.insertSession(parent)
    const child = sessionFixture({
      id: 'late-child',
      seq: 2,
      userId: parent.userId,
      parentSessionId: parent.id,
      rootSessionId: parent.id,
    })
    await repo.deleteSession(parent.userId, parent.id, [parent.id])
    await expect(repo.insertSession(child)).rejects.toThrow('Session parent is unavailable')
    expect(await repo.getSession(parent.userId, child.id)).toBeNull()
  })

  test('a child cannot attach to another owner’s parent', async () => {
    const parent = sessionFixture({ id: 'parent', seq: 1 })
    await repo.insertSession(parent)
    const child = sessionFixture({
      id: 'foreign-child',
      seq: 2,
      userId: 'other-owner',
      parentSessionId: parent.id,
      rootSessionId: parent.id,
    })
    await expect(repo.insertSession(child)).rejects.toThrow('Session parent is unavailable')
    expect(await repo.getSession(child.userId, child.id)).toBeNull()
  })

  test('deleting a session removes every generation and preserves unrelated sessions', async () => {
    const root = sessionFixture({ id: 'root', seq: 1 })
    await repo.insertSession(root)
    for (const [index, id] of ['child', 'grandchild', 'leaf'].entries()) {
      await repo.insertSession(
        sessionFixture({
          id,
          seq: index + 2,
          userId: root.userId,
          parentSessionId: index === 0 ? root.id : ['child', 'grandchild'][index - 1]!,
          rootSessionId: root.id,
        }),
      )
    }
    await repo.insertSession(sessionFixture({ id: 'unrelated', seq: 5, userId: root.userId }))
    await repo.deleteSession(root.userId, root.id, ['root', 'child', 'grandchild', 'leaf'])
    for (const id of ['root', 'child', 'grandchild', 'leaf'])
      expect(await repo.getSession(root.userId, id)).toBeNull()
    expect(await repo.getSession(root.userId, 'unrelated')).not.toBeNull()
  })

  test('authorship and its display snapshot survive reassignment and streaming updates', async () => {
    const session = sessionFixture({
      agents: routedParticipants({ agentId: 'original-id', handle: 'old-name' }),
    })
    await repo.insertSession(session)
    await repo.insertMessage({
      id: 'reply',
      userId: session.userId,
      sessionId: session.id,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      payload: { id: 'reply', role: 'assistant', from: sessionAgent(session), content: 'Before' },
    })
    await repo.updateSession(session.userId, session.id, {
      agents: routedParticipants({ agentId: 'replacement-id', handle: 'old-name' }),
    })
    await repo.updateMessage(
      session.userId,
      session.id,
      'reply',
      { content: 'After' },
      session.updatedAt,
    )
    const [saved] = await repo.listMessages(session.userId, session.id)
    expect(saved!.payload).toMatchObject({
      from: 'agent:original-id',
      authorSnapshot: { handle: 'old-name' },
      content: 'After',
    })
    const forged = { authorSnapshot: { handle: 'forged' } } as unknown as StoredMessagePatch
    expect(mergeMessagePayload(saved!.payload, forged).authorSnapshot).toEqual({
      handle: 'old-name',
    })
    expect((await repo.lastMessagesByUser(session.userId)).get(session.id)).toMatchObject({
      from: 'agent:original-id',
      authorSnapshot: { handle: 'old-name' },
    })
  })

  test('same display handles retain distinct identities and routes after persistence', async () => {
    const session = sessionFixture({
      agents: [
        ...routedParticipants({
          agentId: 'original-id',
          handle: 'reviewer',
          modelId: 'original-model',
        }),
        ...routedParticipants({
          agentId: 'replacement-id',
          handle: 'reviewer',
          modelId: 'replacement-model',
        }),
      ],
    })
    await repo.insertSession(session)
    expect((await repo.getSession(session.userId, session.id))?.agents).toEqual(session.agents)
    await repo.updateSessionAgentRoute(session.userId, session.id, 'original-id', {
      modelId: 'changed',
    })
    const saved = (await repo.getSession(session.userId, session.id))!
    expect(saved.agents.map(({ agentId, modelId }) => ({ agentId, modelId }))).toEqual([
      { agentId: 'original-id', modelId: 'changed' },
      { agentId: 'replacement-id', modelId: 'replacement-model' },
    ])
    await repo.updateSessionAgentRoute(session.userId, session.id, 'reviewer', { modelId: 'wrong' })
    expect((await repo.getSession(session.userId, session.id))?.agents).toEqual(saved.agents)
  })

  test('missing or partial identities never read as the default agent or a partial party', () => {
    expect(parseParticipants(null)).toEqual([])
    expect(parseParticipants('invalid')).toEqual([])
    expect(parseParticipants(JSON.stringify([{ handle: 'reviewer' }]))).toEqual([])
    expect(
      parseParticipants(JSON.stringify([...routedParticipants(), { handle: 'reviewer' }])),
    ).toEqual([])
    expect(parseParticipants(JSON.stringify(routedParticipants()))).toEqual(routedParticipants())
  })

  test('a foreign owner cannot replace the party, including with a party-only patch', async () => {
    const session = sessionFixture()
    await repo.insertSession(session)
    const agents = routedParticipants({ handle: 'qa', modelId: 'changed' })
    await repo.updateSession('another-user', session.id, { title: 'Changed', agents })
    await repo.updateSession('another-user', session.id, { agents })
    expect(await repo.getSession(session.userId, session.id)).toMatchObject({
      title: session.title,
      agents: session.agents,
    })
    // Positive control: the same patch is legal for the owner.
    await repo.updateSession(session.userId, session.id, { title: 'Changed', agents })
    expect(await repo.getSession(session.userId, session.id)).toMatchObject({
      title: 'Changed',
      agents,
    })
    await repo.updateSession(session.userId, session.id, { agents: session.agents })
    expect((await repo.getSession(session.userId, session.id))?.agents).toEqual(session.agents)
  })

  test('a failed party replacement rolls back both deletion and session metadata', async () => {
    const session = sessionFixture()
    await repo.insertSession(session)
    const duplicate = routedParticipants({ handle: 'qa' })[0]
    await expect(
      repo.updateSession(session.userId, session.id, {
        title: 'Must roll back',
        agents: [duplicate, duplicate],
      }),
    ).rejects.toThrow()
    expect(await repo.getSession(session.userId, session.id)).toMatchObject({
      title: session.title,
      agents: session.agents,
    })
  })

  test('a membership change never rewrites what the people who stay run on', async () => {
    // The record a patch carries was read with its routes RESOLVED — the chain had already
    // filled each blank from the project, the agent's card or the last route chosen. Writing
    // those back turned an inheritance into a choice, so the seat stopped being blank and every
    // level below the session stopped being consulted for that conversation ever again.
    const session = sessionFixture({
      agents: [
        ...routedParticipants({ agentId: 'lead', handle: 'lead' }),
        ...routedParticipants({ agentId: 'qa', handle: 'qa', modelId: 'qa/chosen' }),
      ],
    })
    await repo.insertSession(session)

    await repo.updateSession(session.userId, session.id, {
      title: 'Renamed',
      agents: [
        // As a reader would hand them back: the blank seat filled in by the chain.
        { ...session.agents[0]!, modelId: 'inherited/from-the-project' },
        session.agents[1]!,
      ],
    })

    const stored = await repo.getSession(session.userId, session.id)
    expect(stored?.title).toBe('Renamed')
    expect(stored?.agents.map((member) => [member.agentId, member.modelId])).toEqual([
      ['lead', ''],
      ['qa', 'qa/chosen'],
    ])
  })

  test('a newcomer is seated without disturbing the seats already there', async () => {
    const session = sessionFixture({
      agents: routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'lead/model' }),
    })
    await repo.insertSession(session)

    await repo.updateSession(session.userId, session.id, {
      agents: [
        session.agents[0]!,
        ...routedParticipants({ agentId: 'qa', handle: 'qa', reasoningEffort: 'high' }),
      ],
    })
    // …and a departure removes only the row that left.
    const seated = await repo.getSession(session.userId, session.id)
    expect(seated?.agents.map((member) => member.agentId)).toEqual(['lead', 'qa'])
    expect(seated?.agents[0]?.modelId).toBe('lead/model')

    await repo.updateSession(session.userId, session.id, { agents: [session.agents[0]!] })
    const remaining = await repo.getSession(session.userId, session.id)
    expect(remaining?.agents.map((member) => member.agentId)).toEqual(['lead'])
    expect(remaining?.agents[0]?.modelId).toBe('lead/model')
  })

  test('the user’s last choice is read per agent, out of the seats themselves', async () => {
    // No separate store: a seat holds a model only when someone picked one there, so the seats
    // already ARE the record of what was chosen. A second copy would be a second thing to keep
    // in step with the picker.
    await repo.insertSession(
      sessionFixture({
        id: 'older',
        seq: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
        agents: routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'lead/old' }),
      }),
    )
    await sql`UPDATE conversation_participants SET model_selected_at = '2026-01-01T00:00:00.000Z' WHERE session_id = 'older'`.execute(
      db,
    )
    await repo.insertSession(
      sessionFixture({
        id: 'newer',
        seq: 2,
        updatedAt: '2026-02-01T00:00:00.000Z',
        agents: [
          ...routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'lead/new' }),
          // A room's SECOND member counts too: reading position 0 alone dropped the model
          // chosen for everyone else in the conversation.
          ...routedParticipants({
            agentId: 'qa',
            handle: 'qa',
            modelId: 'qa/new',
            reasoningEffort: 'max',
          }),
        ],
      }),
    )
    await sql`UPDATE conversation_participants SET model_selected_at = '2026-02-01T00:00:00.000Z' WHERE session_id = 'newer'`.execute(
      db,
    )
    // A pinned conversation does not outrank a fresher one: pinning is about the sidebar.
    await repo.insertSession(
      sessionFixture({
        id: 'pinned',
        seq: 3,
        isPinned: true,
        updatedAt: '2025-01-01T00:00:00.000Z',
        agents: routedParticipants({ agentId: 'lead', handle: 'lead', modelId: 'lead/ancient' }),
      }),
    )
    await sql`UPDATE conversation_participants SET model_selected_at = '2025-01-01T00:00:00.000Z' WHERE session_id = 'pinned'`.execute(
      db,
    )

    // Activity in the old conversation is not another model selection and must not restore it.
    await sql`UPDATE agent_sessions SET updated_at = '2027-01-01T00:00:00.000Z' WHERE id = 'older'`.execute(
      db,
    )

    const recent = await repo.listRecentRoutes('user-1')
    expect(recent.byAgent.get('lead')?.modelId).toBe('lead/new')
    expect(recent.byAgent.get('qa')?.modelId).toBe('qa/new')
    expect(recent.effortByAgent.get('qa')).toBe('max')
  })

  test('a child model inherited from the room does not become an agent preference', async () => {
    await repo.insertSession(
      sessionFixture({
        id: 'inherited-child',
        seq: 1,
        agents: routedParticipants({
          agentId: 'architect',
          handle: 'architect',
          modelId: 'main/model',
          modelOrigin: 'primary',
        }),
      }),
    )

    const recent = await repo.listRecentRoutes('user-1')
    expect(recent.byAgent.has('architect')).toBe(false)
  })

  test('reopening an external session preserves its complete ordered party', async () => {
    const key = 'channel:conversation'
    let factoryCalls = 0
    const createRecord = (ref: { seq: number; id: string }) => {
      factoryCalls++
      return sessionFixture({
        ...ref,
        sourceToolCallId: key,
        agents: [
          ...routedParticipants({ handle: 'qa', modelId: 'qa-model', reasoningEffort: 'high' }),
          ...routedParticipants({ handle: 'backend', modelId: 'backend-model' }),
        ],
      })
    }
    const first = await repo.getOrCreateExternalSession('user-1', key, createRecord)
    const reopened = await repo.getOrCreateExternalSession('user-1', key, createRecord)
    expect(first.created).toBe(true)
    expect(reopened.created).toBe(false)
    expect(factoryCalls).toBe(1)
    expect(reopened.session.agents).toEqual(first.session.agents)
  })
})
