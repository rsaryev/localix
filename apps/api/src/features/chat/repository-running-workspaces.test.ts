import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { sessionFixture } from '../../testing/session-fixture'
import { createProjectsRepository } from '../projects/repository'
import { createChatRepository } from './repository'

const tempDir = join(tmpdir(), `localix-chat-running-workspaces-tests-${process.pid}`)

beforeAll(async () => mkdir(tempDir, { recursive: true }))
afterAll(async () => rm(tempDir, { recursive: true, force: true }))

test('running workspace roster is owner-scoped, chat-only, and fresh', async () => {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  try {
    await migrateToLatest(db)
    const repo = createChatRepository(db)
    await createProjectsRepository(db).insertProject({
      id: 'PRJ-fixture',
      seq: 1,
      userId: 'user-1',
      name: 'Workspace',
      workingDir: '/repo',
      settings: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    })
    await repo.insertSession(sessionFixture({ id: 'a', seq: 1, runtimeStatus: 'running' }))
    await repo.insertSession(sessionFixture({ id: 'b', seq: 2, runtimeStatus: 'idle' }))
    await repo.insertSession(
      sessionFixture({ id: 'child', seq: 3, sessionKind: 'subagent', runtimeStatus: 'running' }),
    )
    await repo.insertSession(
      sessionFixture({ id: 'foreign', seq: 4, userId: 'other', runtimeStatus: 'running' }),
    )
    const initial = await repo.listRunningChatWorkspaces('user-1')
    expect(initial.map((row) => row.id)).toEqual(['a'])
    expect(initial[0]?.working_dir).toBe('/repo')
    await repo.updateSession('user-1', 'b', { runtimeStatus: 'running' })
    expect((await repo.listRunningChatWorkspaces('user-1')).map((row) => row.id).sort()).toEqual([
      'a',
      'b',
    ])
  } finally {
    await destroyDatabase(db)
  }
})
