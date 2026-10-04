import { afterEach, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { routedParticipants, sessionFixture } from '../../../testing/session-fixture'
import { createChatRepository } from '../repository'
import type { SessionRecord } from '../repository'
import { changeParticipants } from './conversation-participants'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map((db) => db.destroy()))
})

async function fixture() {
  const db = createDatabase()
  databases.push(db)
  await migrateToLatest(db)
  const repo = createChatRepository(db)
  const session = sessionFixture({
    id: 's1',
    updatedAt: '2026-09-23T00:00:00.000Z',
    agents: [
      ...routedParticipants({ agentId: 'lead', handle: 'lead' }),
      ...routedParticipants({ agentId: 'qa', handle: 'qa' }),
    ],
  })
  await repo.insertSession(session)
  const cancelled: string[] = []
  const published: SessionRecord[] = []
  const io = {
    repo,
    streamRegistry: { publish: () => {} },
    now: () => '2026-09-23T01:00:00.000Z',
    publishSession: (s: SessionRecord) => published.push(s),
    cancelAgentTurn: async (_u: string, _s: string, agentId: string) => {
      cancelled.push(agentId)
    },
  }
  return { repo, session, io, cancelled, published }
}

const without = (agentId: string) => (current: SessionRecord) =>
  current.agents.filter((member) => member.agentId !== agentId)

describe('the one participants writer', () => {
  test('a list built from an older revision is refused instead of erasing the newer change', async () => {
    const { repo, session, io } = await fixture()
    // Someone else changed the conversation after this editor loaded it.
    await repo.updateSession(session.userId, session.id, { updatedAt: '2026-09-23T00:30:00.000Z' })
    await expect(
      changeParticipants(io, {
        userId: session.userId,
        sessionId: session.id,
        expectedUpdatedAt: session.updatedAt,
        decide: without('qa'),
      }),
    ).rejects.toThrow('changed since it was loaded')
    const stored = await repo.getSession(session.userId, session.id)
    expect(stored!.agents.map((member) => member.agentId)).toEqual(['lead', 'qa'])
  })

  test('removing a participant cancels its queued turns and announces the change', async () => {
    const { repo, session, io, cancelled, published } = await fixture()
    const change = await changeParticipants(io, {
      userId: session.userId,
      sessionId: session.id,
      expectedUpdatedAt: session.updatedAt,
      decide: without('qa'),
    })
    expect(change.left.map((member) => member.agentId)).toEqual(['qa'])
    expect(cancelled).toEqual(['qa'])
    expect(published).toHaveLength(1)
    const notices = (await repo.listMessages(session.userId, session.id)).filter(
      (message) => message.payload.systemNotice?.kind === 'participants_change',
    )
    expect(notices.map((message) => message.payload.content)).toEqual([
      '@qa left the conversation.',
    ])
  })

  test('the participant that is speaking cannot be removed', async () => {
    const { session, io } = await fixture()
    await expect(
      changeParticipants(
        { ...io, activeAgentId: () => 'qa' },
        { userId: session.userId, sessionId: session.id, decide: without('qa') },
      ),
    ).rejects.toThrow('Stop the active agent')
  })

  test('a fixed roster refuses every change, from whichever door it comes', async () => {
    const { repo, session, io, published } = await fixture()
    await repo.updateSession(session.userId, session.id, { rosterLocked: true })
    await expect(
      changeParticipants(io, {
        userId: session.userId,
        sessionId: session.id,
        decide: (current) => [
          ...current.agents,
          ...routedParticipants({ agentId: 'design', handle: 'design' }),
        ],
      }),
    ).rejects.toThrow('fixed')
    await expect(
      changeParticipants(io, {
        userId: session.userId,
        sessionId: session.id,
        decide: without('qa'),
      }),
    ).rejects.toThrow('fixed')
    const stored = await repo.getSession(session.userId, session.id)
    expect(stored!.agents.map((member) => member.agentId)).toEqual(['lead', 'qa'])
    expect(published).toHaveLength(0)
  })

  // Every turn's `conversation_control` goes through here even with only `next`; refusing the
  // unchanged list would fail an ordinary turn in a fixed conversation.
  test('a fixed roster still answers a call that changes nobody', async () => {
    const { repo, session, io } = await fixture()
    await repo.updateSession(session.userId, session.id, { rosterLocked: true })
    const change = await changeParticipants(io, {
      userId: session.userId,
      sessionId: session.id,
      decide: (current) => current.agents,
    })
    expect(change.joined).toEqual([])
    expect(change.left).toEqual([])
  })
})
