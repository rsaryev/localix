import { expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createProviderConnectionsRepository } from './repository'

test('a connection announces its sign-in and its deletion on the core feed', async () => {
  const db = createDatabase()
  await migrateToLatest(db)
  const repo = createProviderConnectionsRepository(db)
  const at = '2026-01-01T00:00:00.000Z'
  await repo.insert({
    id: 'c1',
    userId: 'u1',
    providerId: 'openrouter',
    providerName: 'OpenRouter',
    label: 'default',
    authType: 'api-key',
    createdAt: at,
    updatedAt: at,
  })
  await repo.announceUpserted('u1', 'c1')
  await repo.delete('u1', 'c1')
  // Deleting what is gone announces nothing.
  await repo.delete('u1', 'c1')
  const rows = await db
    .selectFrom('change_events')
    .select(['stream', 'entity', 'op', 'ref_json'])
    .orderBy('seq')
    .execute()
  const ref = JSON.stringify({ id: 'c1', userId: 'u1', providerId: 'openrouter' })
  expect(rows).toEqual([
    { stream: 'core', entity: 'provider.connection', op: 'upserted', ref_json: ref },
    { stream: 'core', entity: 'provider.connection', op: 'deleted', ref_json: ref },
  ])
})
