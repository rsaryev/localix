import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createSkillUsageRepository } from './repository'

const tempDir = join(tmpdir(), `localix-skill-usage-repo-tests-${process.pid}`)

async function makeDb() {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return db
}

describe('skills-curator repository', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('recordUse creates the row and increments get_count + last_used_at', async () => {
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)

    expect(await repo.get('u1', '', 'deploy', 'global')).toBeNull()

    await repo.recordUse('u1', '', 'deploy', 'global')
    await repo.recordUse('u1', '', 'deploy', 'global', '2026-06-10T00:00:00.000Z')

    const row = await repo.get('u1', '', 'deploy', 'global')
    expect(row?.getCount).toBe(2)
    expect(row?.lastUsedAt).toBe('2026-06-10T00:00:00.000Z')
    expect(row?.pinned).toBe(false)
    expect(row?.archivedAt).toBeNull()

    await destroyDatabase(db)
  })

  test('project, no-project and user keep usage rows separate', async () => {
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)

    await repo.recordUse('u1', '', 'deploy', 'global')
    await repo.recordUse('u1', 'project-a', 'deploy', 'project')
    await repo.recordUse('u1', 'project-b', 'deploy', 'project')
    await repo.recordUse('u2', '', 'deploy', 'global')

    expect((await repo.get('u1', '', 'deploy', 'global'))?.getCount).toBe(1)
    expect((await repo.get('u1', 'project-a', 'deploy', 'project'))?.getCount).toBe(1)
    expect((await repo.get('u1', 'project-b', 'deploy', 'project'))?.getCount).toBe(1)
    expect(await repo.list('u1', '')).toHaveLength(1)
    expect(await repo.list('u1', 'project-a')).toHaveLength(1)
    expect(await repo.list('u2', '')).toHaveLength(1)

    await destroyDatabase(db)
  })

  test('setPinned and setArchivedAt round-trip (creating the row when absent)', async () => {
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)

    const pinned = await repo.setPinned('u1', '', 'notes', 'global', true)
    expect(pinned.pinned).toBe(true)
    expect((await repo.get('u1', '', 'notes', 'global'))?.pinned).toBe(true)

    const archived = await repo.setArchivedAt(
      'u1',
      '',
      'notes',
      'global',
      '2026-06-11T00:00:00.000Z',
    )
    expect(archived.archivedAt).toBe('2026-06-11T00:00:00.000Z')

    const restored = await repo.setArchivedAt('u1', '', 'notes', 'global', null)
    expect(restored.archivedAt).toBeNull()
    // The pin survives archive/restore.
    expect((await repo.get('u1', '', 'notes', 'global'))?.pinned).toBe(true)

    await destroyDatabase(db)
  })
  test('concurrent uses of one skill cannot lose an increment', async () => {
    // The defect this replaced, measured against this same real database: 25 concurrent
    // read-then-write increments landed a final count of 2, losing 24. Skills tick less often
    // than tools, but the correct statement is shorter than the wrong one.
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)

    await Promise.all(
      Array.from({ length: 25 }, () => repo.recordUse('u1', '', 'deploy', 'global')),
    )

    expect((await repo.get('u1', '', 'deploy', 'global'))?.getCount).toBe(25)

    await destroyDatabase(db)
  })

  test('the upsert does not disturb pin or archive state', async () => {
    // `INSERT … ON CONFLICT DO UPDATE` names every column on the way in; forgetting to leave
    // `pinned`/`archived_at` alone would silently un-pin a skill on its next use.
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)
    await repo.setPinned('u1', '', 'deploy', 'global', true)
    await repo.setArchivedAt('u1', '', 'deploy', 'global', '2026-01-01T00:00:00.000Z')

    await repo.recordUse('u1', '', 'deploy', 'global')

    const row = await repo.get('u1', '', 'deploy', 'global')
    expect(row).toMatchObject({ pinned: true, archivedAt: '2026-01-01T00:00:00.000Z', getCount: 1 })

    await destroyDatabase(db)
  })

  test('markAuthored flags a skill created in Localix, dates a new row, and leaves use alone', async () => {
    const db = await makeDb()
    const repo = createSkillUsageRepository(db)
    expect((await repo.get('u1', '', 'cc-made', 'global'))?.localixAuthored).toBeUndefined()

    await repo.markAuthored('u1', '', 'mine', 'global', '2026-01-02T00:00:00.000Z')
    await repo.recordUse('u1', '', 'mine', 'global')
    await repo.markAuthored('u1', '', 'mine', 'global', '2030-01-01T00:00:00.000Z')
    await repo.recordUse('u1', '', 'used-first', 'global')
    await repo.markAuthored('u1', '', 'used-first', 'global')

    expect(await repo.get('u1', '', 'mine', 'global')).toMatchObject({
      localixAuthored: true,
      createdAt: '2026-01-02T00:00:00.000Z',
      getCount: 1,
    })
    expect((await repo.get('u1', '', 'used-first', 'global'))?.localixAuthored).toBe(true)
    // A row made by use alone (a skill Claude Code made) stays unflagged.
    await repo.recordUse('u1', '', 'cc-made', 'global')
    expect((await repo.get('u1', '', 'cc-made', 'global'))?.localixAuthored).toBe(false)

    await destroyDatabase(db)
  })
})
