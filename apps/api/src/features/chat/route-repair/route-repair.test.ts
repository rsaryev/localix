import { describe, expect, test } from 'bun:test'
import type { RouteConnection } from '@localixai/agent/catalog'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../../changes/core-entities'
import { createRouteRepair, type StoredRouteHint } from './route-repair'
import { createRouteSeatsRepository } from './seats-repository'

const DEEPSEEK = 'deepseek/deepseek-chat'
const CATALOG = [
  { id: DEEPSEEK, providerId: 'openrouter' },
  { id: 'gpt-4o', providerId: 'openai' },
]

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  let connections: RouteConnection[] = [{ id: 'or-old', providerId: 'openrouter' }]
  const projects = new Map<string, StoredRouteHint>([
    ['p1', { modelId: DEEPSEEK, providerConnectionId: 'or-old' }],
  ])
  let routing: Record<string, StoredRouteHint> | undefined = {
    title: { modelId: DEEPSEEK, providerConnectionId: 'or-old' },
  }
  const published: string[][] = []
  const stranded: string[][] = []
  const repair = createRouteRepair({
    seats: createRouteSeatsRepository(db),
    connections: async () => connections,
    catalog: async () => CATALOG,
    projects: {
      routes: async () => [...projects].map(([id, route]) => ({ id, ...route })),
      rebind: async (_u, id, to) => {
        projects.set(id, { ...projects.get(id), providerConnectionId: to })
      },
    },
    routing: {
      read: async () => routing,
      write: async (_u, next) => {
        routing = next
      },
    },
    users: async () => ['u1'],
    stranded: (_u, ids) => void stranded.push([...ids]),
    publish: (_u, resources) => void published.push(resources),
  })
  for (const [id, provider] of [
    ['or-old', 'openrouter'],
    ['or-new', 'openrouter'],
    ['openai-1', 'openai'],
  ])
    await db
      .insertInto('provider_connections')
      .values({
        id,
        user_id: 'u1',
        provider_id: provider,
        provider_name: provider,
        label: id,
        auth_type: 'api-key',
        status: 'active',
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
      })
      .execute()
  await db
    .insertInto('agent_sessions')
    .values({
      id: 's1',
      user_id: 'u1',
      title: 'chat',
      project_id: 'p1',
      model_choices: JSON.stringify({
        agents: { a2: { modelId: DEEPSEEK, providerConnectionId: 'or-old' } },
        chosenAt: { a2: '2026-01-01T00:00:00.000Z' },
      }),
    })
    .execute()
  const seat = (agent_id: string, provider_connection_id: string | null, model_id: string) =>
    db
      .insertInto('conversation_participants')
      .values({ session_id: 's1', agent_id, handle: agent_id, provider_connection_id, model_id })
      .execute()
  await seat('a1', 'or-old', DEEPSEEK)
  await seat('a3', 'openai-1', 'gpt-4o')
  const seats = () =>
    db
      .selectFrom('conversation_participants')
      .select(['agent_id', 'provider_connection_id'])
      .orderBy('agent_id')
      .execute()
  const choices = async () =>
    JSON.parse(
      (await db.selectFrom('agent_sessions').select('model_choices').executeTakeFirstOrThrow())
        .model_choices!,
    )
  return {
    db,
    repair,
    seats,
    choices,
    projects,
    routing: () => routing,
    published,
    stranded,
    signIn: (next: RouteConnection[]) => (connections = next),
  }
}

describe('route repair', () => {
  test('old OpenRouter connection deleted, new one signed in: DeepSeek routes move to it', async () => {
    const t = await setup()
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('route-repair', t.repair.handlers, { kind: 'reactor' })
    const ref = (id: string) => ({ id, userId: 'u1', providerId: 'openrouter' })

    t.signIn([])
    // The owner's delete: the foreign key empties the seat; the notice is what repair hears.
    await t.db.deleteFrom('provider_connections').where('id', '=', 'or-old').execute()
    await recordCoreChanges(t.db, {
      entity: 'provider.connection',
      op: 'deleted',
      ref: ref('or-old'),
    })
    await feed.settle()
    // Nothing can serve the model yet: nothing is guessed, and the chat is reported stranded.
    expect((await t.seats())[0]?.provider_connection_id).toBeNull()
    expect(t.stranded.at(-1)).toEqual(['s1'])

    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    await recordCoreChanges(t.db, {
      entity: 'provider.connection',
      op: 'upserted',
      ref: ref('or-new'),
    })
    await feed.settle()
    expect(await t.seats()).toEqual([
      { agent_id: 'a1', provider_connection_id: 'or-new' },
      // Another provider's seat is not crossed over to OpenRouter.
      { agent_id: 'a3', provider_connection_id: 'openai-1' },
    ])
    const choices = await t.choices()
    expect(choices.agents.a2.providerConnectionId).toBe('or-new')
    expect(choices.chosenAt.a2).toBe('2026-01-01T00:00:00.000Z')
    expect(t.projects.get('p1')?.providerConnectionId).toBe('or-new')
    expect(t.routing()?.title?.providerConnectionId).toBe('or-new')
    expect(t.published.at(-1)).toEqual(['sessions', 'projects', 'profile'])
    await feed.close()
  })

  test('a duplicate delivery changes nothing more', async () => {
    const t = await setup()
    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    await t.repair.repairUser('u1')
    const published = t.published.length
    expect(await t.repair.repairUser('u1')).toEqual([])
    expect(t.published.length).toBe(published)
    expect((await t.seats())[0]?.provider_connection_id).toBe('or-new')
  })

  test('a gap is closed by the reconcile', async () => {
    const t = await setup()
    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    const feed = createCoreChangeFeed(t.db)
    // No notice was recorded (it was missed): the new consumer's reconcile repairs from the owners.
    await feed.subscribe('route-repair', t.repair.handlers, {
      kind: 'reactor',
      reconcile: () => t.repair.repairAll(),
    })
    await feed.settle()
    expect((await t.seats())[0]?.provider_connection_id).toBe('or-new')
    await feed.close()
  })

  test('a disabled-key connection is not a live route', async () => {
    const t = await setup()
    t.signIn([
      { id: 'or-old', providerId: 'openrouter', usable: false },
      { id: 'or-new', providerId: 'openrouter' },
    ])
    await t.repair.repairUser('u1')
    expect((await t.seats())[0]?.provider_connection_id).toBe('or-new')
  })

  test('a local model installed repairs every user’s routes', async () => {
    const t = await setup()
    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    const handler = t.repair.handlers['local.model']
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'local.model', op: 'upserted', ref: { id: 'qwen' } })
    expect((await t.seats())[0]?.provider_connection_id).toBe('or-new')
  })
})
