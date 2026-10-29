import { afterEach, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createDismissalsRepository } from './dismissals-repository'

const dbs: Array<ReturnType<typeof createDatabase>> = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await destroyDatabase(db)
})

async function repository() {
  const db = createDatabase()
  dbs.push(db)
  await migrateToLatest(db)
  return createDismissalsRepository(db, () => '2026-10-29T00:00:00Z')
}

test('a package turned down stays down for that person only, until they take it back', async () => {
  const dismissals = await repository()
  const ref = { kind: 'plugin' as const, id: 'docker' }

  await dismissals.set('u1', ref, 'not-interested')
  await dismissals.set('u1', ref, 'removed')

  expect(await dismissals.list('u1')).toEqual(new Set(['plugin:docker']))
  expect(await dismissals.list('u2')).toEqual(new Set())

  await dismissals.set('u1', ref, null)
  expect(await dismissals.list('u1')).toEqual(new Set())
})

test('what was turned down reads back newest first, each with its first reason', async () => {
  const dismissals = await repository()
  const docker = { kind: 'plugin' as const, id: 'docker' }
  const fonts = { kind: 'mini-app' as const, id: 'fonts' }

  await dismissals.set('u1', docker, 'not-interested')
  await dismissals.set('u1', fonts, 'removed')
  await dismissals.set('u1', docker, 'removed')

  expect(await dismissals.entries('u1')).toEqual([
    { ref: fonts, reason: 'removed' },
    { ref: docker, reason: 'not-interested' },
  ])
})
