import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../../changes/core-entities'
import { createAgentSeats } from './agent-seats'
import { createAgentSeatsRepository } from './seats-repository'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  const agents = new Map([
    ['a1', 'writer'],
    ['a2', 'critic'],
  ])
  // Ids with a binding row: an agent whose file or plugin is away is still bound.
  const bound = new Set(['a1', 'a2'])
  const forgotten: string[] = []
  const published: string[][] = []
  const seats = createAgentSeats({
    seats: createAgentSeatsRepository(db),
    handles: async () => new Map(agents),
    bound: async (id) => bound.has(id),
    forgetModelSettings: async (id) => void forgotten.push(id),
    publish: (resources) => void published.push(resources),
  })
  const session = async (id: string, members: string[]) => {
    await db
      .insertInto('agent_sessions')
      .values({
        id,
        user_id: 'u1',
        title: id,
        project_id: 'p1',
        model_choices: JSON.stringify({
          agents: Object.fromEntries(members.map((m) => [m, { modelId: 'm' }])),
          chosenAt: Object.fromEntries(members.map((m) => [m, '2026-01-01'])),
        }),
      })
      .execute()
    for (const [position, agent] of members.entries())
      await db
        .insertInto('conversation_participants')
        .values({ session_id: id, agent_id: agent, handle: agent, position, model_id: 'm' })
        .execute()
  }
  await session('group', ['a1', 'a2'])
  await session('solo', ['a2'])
  const rows = () =>
    db
      .selectFrom('conversation_participants')
      .select(['session_id', 'agent_id', 'handle'])
      .orderBy('session_id')
      .orderBy('agent_id')
      .execute()
  return { db, agents, bound, seats, forgotten, published, rows }
}

const ref = (id: string, agentId: string) => ({ id, scope: 'p1', agentId })

describe('agent seats', () => {
  test('a rename moves the seats’ handle; a duplicate changes nothing', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('agent-seats', t.seats.handlers, { kind: 'reactor' })
    t.agents.set('a2', 'reviewer')
    const rename = [
      { entity: 'agent' as const, op: 'deleted' as const, ref: ref('critic', 'a2') },
      { entity: 'agent' as const, op: 'upserted' as const, ref: ref('reviewer', 'a2') },
    ]
    await recordCoreChanges(t.db, rename)
    await recordCoreChanges(t.db, rename)
    await feed.settle()
    expect((await t.rows()).filter((r) => r.agent_id === 'a2').map((r) => r.handle)).toEqual([
      'reviewer',
      'reviewer',
    ])
    // A rename is not a deletion: nothing left, nothing forgotten, one poke.
    expect((await t.rows()).length).toBe(3)
    expect(t.forgotten).toEqual([])
    expect(t.published).toEqual([['sessions']])
    await feed.close()
  })

  test('a deletion leaves shared rooms, keeps a solo seat, forgets its picks', async () => {
    const t = await setup()
    t.agents.delete('a2')
    const handler = t.seats.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'deleted', ref: ref('critic', 'a2') })
    await handler({ entity: 'agent', op: 'deleted', ref: ref('critic', 'a2') })
    expect(await t.rows()).toEqual([
      { session_id: 'group', agent_id: 'a1', handle: 'a1' },
      { session_id: 'solo', agent_id: 'a2', handle: 'a2' },
    ])
    const choices = await t.db.selectFrom('agent_sessions').select('model_choices').execute()
    for (const row of choices) expect(row.model_choices).not.toContain('a2')
    expect(t.forgotten).toEqual(['a2', 'a2'])
  })

  test('each write records the chat.session notice of the chats it changed', async () => {
    const t = await setup()
    const notices = async () =>
      (
        await t.db
          .selectFrom('change_events')
          .select(['op', 'ref_json'])
          .where('entity', '=', 'chat.session')
          .orderBy('seq')
          .execute()
      ).map((row) => ({ op: row.op, ...JSON.parse(row.ref_json!) }))
    t.agents.delete('a2')
    const handler = t.seats.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'deleted', ref: ref('critic', 'a2') })
    // Leaving the shared room, then dropping the picks from both chats' choice maps.
    expect(await notices()).toEqual([
      { op: 'upserted', id: 'group', userId: 'u1' },
      { op: 'upserted', id: 'group', userId: 'u1' },
      { op: 'upserted', id: 'solo', userId: 'u1' },
    ])
    // The reactor ignores its own notices, so they cannot loop back into it.
    expect(t.seats.handlers['chat.session']).toBe('ignore')
  })

  test('the reconcile repairs handles and keeps the seats of a bound agent that is away', async () => {
    const t = await setup()
    t.agents.set('a1', 'author')
    t.agents.delete('a2')
    await t.seats.reconcile()
    expect(await t.rows()).toEqual([
      { session_id: 'group', agent_id: 'a1', handle: 'author' },
      { session_id: 'group', agent_id: 'a2', handle: 'a2' },
      { session_id: 'solo', agent_id: 'a2', handle: 'a2' },
    ])
    expect(t.forgotten).toEqual([])
  })

  test('a resync leaves the rooms of an id with no row at all, and a repeat changes nothing', async () => {
    const t = await setup()
    t.agents.delete('a2')
    t.bound.delete('a2')
    const handler = t.seats.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'resync' })
    await handler({ entity: 'agent', op: 'resync' })
    expect(await t.rows()).toEqual([
      { session_id: 'group', agent_id: 'a1', handle: 'writer' },
      { session_id: 'solo', agent_id: 'a2', handle: 'a2' },
    ])
    const choices = await t.db.selectFrom('agent_sessions').select('model_choices').execute()
    for (const row of choices) expect(row.model_choices).not.toContain('a2')
    expect(t.forgotten).toContain('a2')
  })
})
