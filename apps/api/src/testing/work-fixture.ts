/**
 * A work registry for a test: on the test's own database when it has one (so rows land where the
 * rest of the test reads), in memory otherwise. Production composes exactly one, in bootstrap.
 */
import type { Kysely } from 'kysely'

import type { AppDatabase } from '../db/types'
import { createMemoryWorkRepository } from '../features/work/memory-repository'
import { createWorkRegistry } from '../features/work/registry'
import { createWorkRepository } from '../features/work/repository'

export function testWork(db?: Kysely<AppDatabase>) {
  return createWorkRegistry({ repo: db ? createWorkRepository(db) : createMemoryWorkRepository() })
}
