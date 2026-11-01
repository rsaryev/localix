import { afterEach, describe } from 'bun:test'
import type { Kysely } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import type { AppDatabase } from '../../db/types'
import { createWorkRepository } from './repository'
import { describeWorkRepositoryContract } from './testing/work-repository.contract'
import { createMemoryWorkRepository } from './testing/memory-repository'

const open: Kysely<AppDatabase>[] = []
afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => destroyDatabase(db)))
})

describe('work repository', () => {
  describeWorkRepositoryContract('the database one', async () => {
    const db = createDatabase()
    open.push(db)
    await migrateToLatest(db)
    for (const id of ['s1', 's2'])
      await db
        .insertInto('agent_sessions')
        .values({ project_id: 'PRJ-test', id, user_id: 'u1', title: id })
        .execute()
    return createWorkRepository(db)
  })
  describeWorkRepositoryContract('the in-memory one', () => createMemoryWorkRepository())
})
