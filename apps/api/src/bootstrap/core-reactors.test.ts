import { describe, expect, test } from 'bun:test'

import { createDatabase } from '../db/connection'
import { migrateToLatest } from '../db/migrator'
import { createCoreChangeFeed } from '../features/changes/core-entities'
import { createCapabilitySourceRepository } from '../features/capabilities/source-repository'
import { createProjectsRepository } from '../features/projects/repository'
import { notificationsCleanupHandlers, miniAppHostHandlers } from './core-reactors'

async function setup() {
  const db = createDatabase()
  await migrateToLatest(db)
  return { db, feed: createCoreChangeFeed(db) }
}

const project = (id: string) => ({
  id,
  userId: 'u1',
  name: id,
  workingDir: `/tmp/${id}`,
  settings: null,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  deletedAt: null,
})

describe('mini app hosts follow projects', () => {
  test('a project created, moved or deleted refreshes; a settings write does not', async () => {
    const { db, feed } = await setup()
    let refreshes = 0
    await feed.subscribe(
      'mini-app-hosts',
      miniAppHostHandlers(() => refreshes++),
      {
        kind: 'reactor',
      },
    )
    const repo = createProjectsRepository(db)
    await repo.insertProject(project('p1'))
    await repo.updateProject('u1', 'p1', { settings: '{}' })
    await repo.updateProject('u1', 'p1', { workingDir: '/tmp/elsewhere' })
    await repo.deleteProject('u1', 'p1', '2026-02-01')
    // Deleting twice is one deletion.
    await repo.deleteProject('u1', 'p1', '2026-02-02')
    await feed.settle()
    expect(refreshes).toBe(3)
    await feed.close()
  })
})

describe('mini app hosts follow their owner', () => {
  test('a mini app settings write refreshes; a plugin settings write does not', async () => {
    const { db, feed } = await setup()
    let refreshes = 0
    await feed.subscribe(
      'mini-app-hosts',
      miniAppHostHandlers(() => refreshes++),
      { kind: 'reactor' },
    )
    await createCapabilitySourceRepository(db, 'plugin').upsert('u1', '', 'linter', {
      config: { strict: true },
    })
    await createCapabilitySourceRepository(db, 'mini-app').upsert('u1', '', 'chess', {
      config: { level: 3 },
    })
    await feed.settle()
    expect(refreshes).toBe(1)
    await feed.close()
  })
})

describe('notifications cleanup', () => {
  test('a deleted connection settles its condition rows; duplicates are harmless', async () => {
    const removed: string[] = []
    const handlers = notificationsCleanupHandlers({
      connectionRemoved: (_u, id) => void removed.push(id),
    })
    const handler = handlers['provider.connection']
    if (handler === 'ignore') throw new Error('expected a handler')
    const ref = { id: 'c1', userId: 'u1', providerId: 'openrouter' }
    await handler({ entity: 'provider.connection', op: 'deleted', ref })
    await handler({ entity: 'provider.connection', op: 'deleted', ref })
    await handler({ entity: 'provider.connection', op: 'upserted', ref })
    expect(removed).toEqual(['c1', 'c1'])
  })
})
