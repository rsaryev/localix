import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'

const tempDir = join(tmpdir(), `localix-ext-scope-isolation-tests-${process.pid}`)

describe('capability state scope isolation', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })

  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('the same plugin, agent and provider keep independent state per project', async () => {
    const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
    await migrateToLatest(db)
    const repositories = [
      createCapabilitySourceRepository(db, 'plugin'),
      createCapabilitySourceRepository(db, 'agent'),
    ]

    for (const repository of repositories) {
      await repository.upsert('user-1', '', 'shared-name', { source: 'local' })
      await repository.upsert('user-1', 'project-a', 'shared-name', { source: 'local' })
      await repository.upsert('user-1', 'project-b', 'shared-name', { source: 'local' })

      expect(await repository.listForScope('user-1', '')).toMatchObject([
        { projectId: '', name: 'shared-name' },
      ])
      expect(await repository.listForScope('user-1', 'project-a')).toMatchObject([
        { projectId: 'project-a', name: 'shared-name' },
      ])
      expect(await repository.listForScope('user-1', 'project-b')).toMatchObject([
        { projectId: 'project-b', name: 'shared-name' },
      ])
    }

    await destroyDatabase(db)
  })
})
