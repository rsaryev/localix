import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { sql } from 'kysely'
import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { routedAgent, sessionFixture } from '../../testing/session-fixture'
import { createChatRepository } from './repository'
import { deleteSession as deleteSessionWithCleanup } from './service/session-deletion'

describe('session agent persistence', () => {
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

  test('the session stores its one agent and the route it runs on', async () => {
    const session = sessionFixture({
      agent: routedAgent({
        agentId: 'original-id',
        name: 'reviewer',
        modelId: 'original-model',
        reasoningEffort: 'high',
      }),
    })
    await repo.insertSession(session)
    expect((await repo.getSession(session.userId, session.id))?.agent).toEqual(session.agent)
    await repo.updateSessionAgentRoute(session.userId, session.id, { modelId: 'changed' })
    const saved = (await repo.getSession(session.userId, session.id))!
    expect(saved.agent).toEqual({ ...session.agent!, modelId: 'changed' })
  })

  test('a session without an agent reads as none, never as the default agent', async () => {
    const session = sessionFixture({ agent: null })
    await repo.insertSession(session)
    expect((await repo.getSession(session.userId, session.id))?.agent).toBeNull()
  })

  test('a session cannot be born with a half-resolved agent', async () => {
    await expect(
      repo.insertSession(sessionFixture({ agent: routedAgent({ agentId: '' }) })),
    ).rejects.toThrow('resolved agent identity')
  })

  test('a foreign owner cannot change the route', async () => {
    const session = sessionFixture()
    await repo.insertSession(session)
    await repo.updateSessionAgentRoute('another-user', session.id, { modelId: 'changed' })
    expect((await repo.getSession(session.userId, session.id))?.agent).toEqual(session.agent)
  })

  test('a title edit never rewrites what the agent runs on', async () => {
    // The record a patch carries was read with its route RESOLVED — the chain had already
    // filled each blank from the project, the agent's card or the last route chosen. Writing
    // that back would turn an inheritance into a choice.
    const session = sessionFixture({ agent: routedAgent({ agentId: 'lead', name: 'lead' }) })
    await repo.insertSession(session)
    await repo.updateSession(session.userId, session.id, { title: 'Renamed' })
    const stored = await repo.getSession(session.userId, session.id)
    expect(stored?.title).toBe('Renamed')
    expect(stored?.agent?.modelId).toBe('')
  })

  test('the user’s last choice is read per agent, out of the sessions themselves', async () => {
    // No separate store: a session holds a model only when someone picked one there, so the
    // sessions already ARE the record of what was chosen.
    const insert = async (
      id: string,
      seq: number,
      agentId: string,
      modelId: string,
      selectedAt: string,
      extra: Parameters<typeof sessionFixture>[0] = {},
    ) => {
      await repo.insertSession(
        sessionFixture({
          id,
          seq,
          agent: routedAgent({ agentId, name: agentId, modelId }),
          ...extra,
        }),
      )
      await sql`UPDATE agent_sessions SET model_selected_at = ${selectedAt} WHERE id = ${id}`.execute(
        db,
      )
    }
    await insert('older', 1, 'lead', 'lead/old', '2026-01-01T00:00:00.000Z')
    await insert('newer', 2, 'lead', 'lead/new', '2026-02-01T00:00:00.000Z')
    await insert('other', 3, 'qa', 'qa/new', '2026-02-01T00:00:00.000Z')
    // A pinned conversation does not outrank a fresher one: pinning is about the sidebar.
    await insert('pinned', 4, 'lead', 'lead/ancient', '2025-01-01T00:00:00.000Z', {
      isPinned: true,
    })

    // Activity in the old conversation is not another model selection and must not restore it.
    await sql`UPDATE agent_sessions SET updated_at = '2027-01-01T00:00:00.000Z' WHERE id = 'older'`.execute(
      db,
    )

    const recent = await repo.listRecentRoutes('user-1')
    expect(recent.byAgent.get('lead')?.modelId).toBe('lead/new')
    expect(recent.byAgent.get('qa')?.modelId).toBe('qa/new')
    // The level is not learned from routes: it is remembered per agent and model.
    expect('effortByAgent' in recent).toBe(false)
  })

  test('a child model inherited from its parent does not become an agent preference', async () => {
    await repo.insertSession(
      sessionFixture({
        id: 'inherited-child',
        seq: 1,
        agent: routedAgent({
          agentId: 'architect',
          name: 'architect',
          modelId: 'main/model',
          modelOrigin: 'primary',
        }),
      }),
    )

    const recent = await repo.listRecentRoutes('user-1')
    expect(recent.byAgent.has('architect')).toBe(false)
  })

  test('reopening an external session preserves its agent and route', async () => {
    const key = 'channel:conversation'
    let factoryCalls = 0
    const createRecord = (ref: { seq: number; id: string }) => {
      factoryCalls++
      return sessionFixture({
        ...ref,
        sourceToolCallId: key,
        agent: routedAgent({ name: 'qa', modelId: 'qa-model', reasoningEffort: 'high' }),
      })
    }
    const first = await repo.getOrCreateExternalSession('user-1', key, createRecord)
    const reopened = await repo.getOrCreateExternalSession('user-1', key, createRecord)
    expect(first.created).toBe(true)
    expect(reopened.created).toBe(false)
    expect(factoryCalls).toBe(1)
    expect(reopened.session.agent).toEqual(first.session.agent)
  })

  test('the newest picked model is the recent route, with the level only when it was picked too', async () => {
    const agent = routedAgent({ name: 'qa', agentId: 'agent-qa' })
    const older = sessionFixture({ id: 'older', seq: 1, agent })
    const newer = sessionFixture({ id: 'newer', seq: 2, userId: older.userId, agent })
    await repo.insertSession(older)
    await repo.insertSession(newer)
    await repo.updateSessionAgentRoute(older.userId, older.id, {
      modelId: 'old-model',
      reasoningEffort: 'low',
    })
    await sql`UPDATE agent_sessions SET model_selected_at = '2026-01-01T00:00:00.000Z'
      WHERE id = 'older'`.execute(db)
    await repo.updateSessionAgentRoute(newer.userId, newer.id, {
      modelId: 'new-model',
      reasoningEffort: 'high',
    })
    expect((await repo.listRecentRoutes(older.userId)).byAgent.get('agent-qa')).toEqual({
      providerConnectionId: null,
      modelId: 'new-model',
      reasoningEffort: 'high',
    })
    await sql`UPDATE agent_sessions SET reasoning_selected_at = NULL WHERE id = 'newer'`.execute(db)
    expect(
      (await repo.listRecentRoutes(older.userId)).byAgent.get('agent-qa')?.reasoningEffort,
    ).toBeUndefined()
  })
})
