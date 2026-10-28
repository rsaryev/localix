import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../../changes/core-entities'
import { createAgentNames } from './agent-names'
import { createAgentNamesRepository } from './names-repository'

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
  const names = createAgentNames({
    sessions: createAgentNamesRepository(db),
    names: async () => new Map(agents),
    bound: async (id) => bound.has(id),
    forgetModelSettings: async (id) => void forgotten.push(id),
    publish: (resources) => void published.push(resources),
  })
  const session = async (id: string, agent: string) => {
    await db
      .insertInto('agent_sessions')
      .values({
        id,
        user_id: 'u1',
        title: id,
        project_id: 'p1',
        agent_id: agent,
        agent_name: agent,
        model_id: 'm',
      })
      .execute()
  }
  await session('first', 'a1')
  await session('second', 'a2')
  await session('third', 'a2')
  const rows = () =>
    db
      .selectFrom('agent_sessions')
      .select(['id as session_id', 'agent_id', 'agent_name as name'])
      .orderBy('id')
      .execute()
  return { db, agents, bound, names, forgotten, published, rows }
}

const ref = (id: string, agentId: string) => ({ id, scope: 'p1', agentId })

describe('agent names', () => {
  test('a rename moves the sessions’ name; a duplicate changes nothing', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('agent-names', t.names.handlers, { kind: 'reactor' })
    t.agents.set('a2', 'reviewer')
    const rename = [
      { entity: 'agent' as const, op: 'deleted' as const, ref: ref('critic', 'a2') },
      { entity: 'agent' as const, op: 'upserted' as const, ref: ref('reviewer', 'a2') },
    ]
    await recordCoreChanges(t.db, rename)
    await recordCoreChanges(t.db, rename)
    await feed.settle()
    expect((await t.rows()).filter((r) => r.agent_id === 'a2').map((r) => r.name)).toEqual([
      'reviewer',
      'reviewer',
    ])
    // A rename is not a deletion: nothing left, nothing forgotten, one poke.
    expect((await t.rows()).length).toBe(3)
    expect(t.forgotten).toEqual([])
    expect(t.published).toEqual([['sessions']])
    await feed.close()
  })

  test('a deletion keeps the sessions of the agent and forgets its picks', async () => {
    const t = await setup()
    t.agents.delete('a2')
    const handler = t.names.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'deleted', ref: ref('critic', 'a2') })
    await handler({ entity: 'agent', op: 'deleted', ref: ref('critic', 'a2') })
    expect(await t.rows()).toEqual([
      { session_id: 'first', agent_id: 'a1', name: 'a1' },
      { session_id: 'second', agent_id: 'a2', name: 'a2' },
      { session_id: 'third', agent_id: 'a2', name: 'a2' },
    ])
    expect(t.forgotten).toEqual(['a2', 'a2'])
  })

  test('a rename records the chat.session notice of the chats it changed', async () => {
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
    t.agents.set('a2', 'reviewer')
    const handler = t.names.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'upserted', ref: ref('reviewer', 'a2') })
    expect(await notices()).toEqual([
      { op: 'upserted', id: 'second', userId: 'u1' },
      { op: 'upserted', id: 'third', userId: 'u1' },
    ])
    // The reactor ignores its own notices, so they cannot loop back into it.
    expect(t.names.handlers['chat.session']).toBe('ignore')
  })

  test('the reconcile repairs names and keeps the sessions of a bound agent that is away', async () => {
    const t = await setup()
    t.agents.set('a1', 'author')
    t.agents.delete('a2')
    await t.names.reconcile()
    expect(await t.rows()).toEqual([
      { session_id: 'first', agent_id: 'a1', name: 'author' },
      { session_id: 'second', agent_id: 'a2', name: 'a2' },
      { session_id: 'third', agent_id: 'a2', name: 'a2' },
    ])
    expect(t.forgotten).toEqual([])
  })

  test('a resync forgets an id with no row at all, and a repeat changes nothing', async () => {
    const t = await setup()
    t.agents.delete('a2')
    t.bound.delete('a2')
    const handler = t.names.handlers.agent
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'agent', op: 'resync' })
    await handler({ entity: 'agent', op: 'resync' })
    expect(await t.rows()).toEqual([
      { session_id: 'first', agent_id: 'a1', name: 'writer' },
      { session_id: 'second', agent_id: 'a2', name: 'a2' },
      { session_id: 'third', agent_id: 'a2', name: 'a2' },
    ])
    expect(t.forgotten).toContain('a2')
  })
})
