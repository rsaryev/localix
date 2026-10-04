import { createDatabase, destroyDatabase } from './connection'
import { migrateToLatest } from './migrator'
import { resolveDbFile, resolveDefaultUserId } from '../lib/env'

// Resolve through the same helper the server boots with. Reading the raw env var
// here meant an unset LOCALIX_DB_FILE handed `createDatabase` an undefined
// filename — which opens `:memory:`, so `bun run db:migrate` migrated a throwaway
// in-memory database, printed every migration as applied, and exited having
// changed nothing on disk.
const dbFile = resolveDbFile()

const db = createDatabase({ filename: dbFile })

try {
  console.log(`Migrating ${dbFile}`)
  const results = await migrateToLatest(db, { defaultUserId: resolveDefaultUserId() })
  for (const result of results ?? []) {
    console.log(`${result.migrationName}: ${result.status}`)
  }
} finally {
  await destroyDatabase(db)
}
