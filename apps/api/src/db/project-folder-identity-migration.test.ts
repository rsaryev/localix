import { afterEach, expect, test } from 'bun:test'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from './connection'
import { shippedMigrations } from './migration-provider'
import { migrateToLatest } from './migrator'

const BEFORE = '20261121T000000_project_folder_identity'

const databases: ReturnType<typeof createDatabase>[] = []
afterEach(async () => {
  await Promise.all(databases.splice(0).map(destroyDatabase))
})

test('a project from before has no folder identity until its folder is seen', async () => {
  const db = createDatabase()
  databases.push(db)
  const all = await shippedMigrations().getMigrations()
  const previous = Object.fromEntries(Object.entries(all).filter(([name]) => name < BEFORE))
  await migrateToLatest(db, { migrations: { getMigrations: async () => previous } })
  await sql`INSERT INTO projects (id, seq, user_id, name, working_dir)
    VALUES ('PRJ-1', 1, 'u1', 'App', '/work/app')`.execute(db)

  await migrateToLatest(db)

  const rows = await sql<{
    working_dir: string
    folder_identity: string | null
  }>`SELECT working_dir, folder_identity FROM projects`.execute(db)
  expect(rows.rows).toEqual([{ working_dir: '/work/app', folder_identity: null }])
})
