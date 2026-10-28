import { describe, expect, test } from 'bun:test'
import type { RouteConnection } from '@localixai/agent/catalog'

import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import { createCoreChangeFeed, recordCoreChanges } from '../../changes/core-entities'
import { createRouteRepair, type StoredRouteHint } from './route-repair'
import { createRouteRepairRepository } from './routes-repository'

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
    routes: createRouteRepairRepository(db),
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
  const session = (id: string, agent_id: string, connection: string | null, model_id: string) =>
    db
      .insertInto('agent_sessions')
      .values({
        id,
        user_id: 'u1',
        title: 'chat',
        project_id: 'p1',
        agent_id,
        agent_name: agent_id,
        provider_connection_id: connection,
        model_id,
      })
      .execute()
  await session('s1', 'a1', 'or-old', DEEPSEEK)
  await session('s3', 'a3', 'openai-1', 'gpt-4o')
  const routes = () =>
    db
      .selectFrom('agent_sessions')
      .select(['agent_id', 'provider_connection_id'])
      .orderBy('agent_id')
      .execute()
  return {
    db,
    repair,
    routes,
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
    // The owner's delete: the foreign key empties the route; the notice is what repair hears.
    await t.db.deleteFrom('provider_connections').where('id', '=', 'or-old').execute()
    await recordCoreChanges(t.db, {
      entity: 'provider.connection',
      op: 'deleted',
      ref: ref('or-old'),
    })
    await feed.settle()
    // Nothing can serve the model yet: nothing is guessed, and the chats are reported stranded (s3 has no live connection either).
    expect((await t.routes())[0]?.provider_connection_id).toBeNull()
    expect(t.stranded.at(-1)).toEqual(['s1', 's3'])

    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    await recordCoreChanges(t.db, {
      entity: 'provider.connection',
      op: 'upserted',
      ref: ref('or-new'),
    })
    await feed.settle()
    expect(await t.routes()).toEqual([
      { agent_id: 'a1', provider_connection_id: 'or-new' },
      // Another provider's route is not crossed over to OpenRouter.
      { agent_id: 'a3', provider_connection_id: 'openai-1' },
    ])
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
    expect((await t.routes())[0]?.provider_connection_id).toBe('or-new')
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
    expect((await t.routes())[0]?.provider_connection_id).toBe('or-new')
    await feed.close()
  })

  test('a repair records the chat.session notice with each rebind, and does not wake itself', async () => {
    const t = await setup()
    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    const sessionNotices = () =>
      t.db
        .selectFrom('change_events')
        .select(['entity', 'op', 'ref_json'])
        .where('entity', '=', 'chat.session')
        .execute()
    await t.repair.repairUser('u1')
    const notices = await sessionNotices()
    // One for the rebound session.
    expect(notices).toHaveLength(1)
    for (const notice of notices) {
      expect(notice.op).toBe('upserted')
      expect(JSON.parse(notice.ref_json!)).toEqual({ id: 's1', userId: 'u1' })
    }
    expect(t.repair.handlers['chat.session']).toBe('ignore')
    // Delivered through the feed, its own notices do not run another repair.
    const feed = createCoreChangeFeed(t.db)
    await feed.subscribe('route-repair', t.repair.handlers, { kind: 'reactor' })
    await feed.settle()
    const published = t.published.length
    await feed.settle()
    expect(t.published.length).toBe(published)
    expect(await sessionNotices()).toHaveLength(1)
    await feed.close()
  })

  test('a disabled-key connection is not a live route', async () => {
    const t = await setup()
    t.signIn([
      { id: 'or-old', providerId: 'openrouter', usable: false },
      { id: 'or-new', providerId: 'openrouter' },
    ])
    await t.repair.repairUser('u1')
    expect((await t.routes())[0]?.provider_connection_id).toBe('or-new')
  })

  test('a local model installed repairs every user’s routes', async () => {
    const t = await setup()
    t.signIn([{ id: 'or-new', providerId: 'openrouter' }])
    const handler = t.repair.handlers['local.model']
    if (handler === 'ignore') throw new Error('expected a handler')
    await handler({ entity: 'local.model', op: 'upserted', ref: { id: 'qwen' } })
    expect((await t.routes())[0]?.provider_connection_id).toBe('or-new')
  })
})
