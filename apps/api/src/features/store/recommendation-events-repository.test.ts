import { afterEach, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createRecommendationEventsRepository } from './recommendation-events-repository'

const dbs: Array<ReturnType<typeof createDatabase>> = []
afterEach(async () => {
  for (const db of dbs.splice(0)) await destroyDatabase(db)
})

async function repository() {
  const db = createDatabase()
  dbs.push(db)
  await migrateToLatest(db)
  return createRecommendationEventsRepository(db)
}

const docker = { kind: 'plugin' as const, id: 'docker' }
const fonts = { kind: 'plugin' as const, id: 'fonts' }

test('showings count by day, an open is remembered, and each person has their own', async () => {
  const events = await repository()
  await events.record('u1', [{ ref: docker, event: 'shown', slot: 0 }], '2026-10-01T09:00:00Z')
  await events.record('u1', [{ ref: docker, event: 'shown', slot: 2 }], '2026-10-01T18:00:00Z')
  await events.record('u1', [{ ref: docker, event: 'shown', slot: 1 }], '2026-10-02T09:00:00Z')
  await events.record('u1', [{ ref: fonts, event: 'opened', slot: 0 }], '2026-10-02T09:00:00Z')

  const seen = await events.exposure('u1', '2026-09-01T00:00:00Z')

  expect(seen.get('plugin:docker')).toEqual({ days: 2, opened: false })
  expect(seen.get('plugin:fonts')).toEqual({ days: 0, opened: true })
  expect((await events.exposure('u2', '2026-09-01T00:00:00Z')).size).toBe(0)
})

test('an install counts for what showed it lately; an install nothing showed counts for none', async () => {
  const events = await repository()
  const at = '2026-10-01T00:00:00Z'
  await events.record('u1', [{ ref: docker, event: 'shown', slot: 3, source: 'open' }], at)

  await events.installed('u1', docker, '2026-10-02T00:00:00Z', '2026-09-15T00:00:00Z')
  await events.installed('u1', fonts, '2026-10-02T00:00:00Z', '2026-09-15T00:00:00Z')
  await events.installed('u1', docker, '2026-10-03T00:00:00Z', '2026-10-02T00:00:00Z')

  expect(await events.stats('u1', '2026-09-01T00:00:00Z')).toEqual({
    open: { shown: 1, opened: 0, installed: 1 },
  })
})

test('every install is kept with its time, the latest per package, whatever showed it', async () => {
  const events = await repository()
  await events.installed('u1', docker, '2026-10-02T00:00:00Z', '2026-09-15T00:00:00Z')
  await events.installed('u1', docker, '2026-10-05T00:00:00Z', '2026-09-15T00:00:00Z')

  const when = await events.installedAt('u1', ['plugin:docker', 'plugin:fonts'])

  expect([...when]).toEqual([['plugin:docker', '2026-10-05T00:00:00Z']])
  expect((await events.installedAt('u2', ['plugin:docker'])).size).toBe(0)
})

test('what is older than ninety days is pruned as new events come in', async () => {
  const events = await repository()
  await events.record('u1', [{ ref: docker, event: 'shown', slot: 0 }], '2026-06-01T00:00:00Z')
  await events.record('u1', [{ ref: fonts, event: 'shown', slot: 0 }], '2026-10-01T00:00:00Z')

  const seen = await events.exposure('u1', '2000-01-01T00:00:00Z')

  expect([...seen.keys()]).toEqual(['plugin:fonts'])
})
