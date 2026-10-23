import { createDatabase, destroyDatabase } from '../../../../db/connection'
import { migrateToLatest } from '../../../../db/migrator'
import type { InboxEntry } from '../../contracts'
import { createNotificationJournal, type NotificationJournal } from '../../journal'

/**
 * A real journal over an in-memory, migrated database — what every condition test records into.
 * The conditions' promises (one row per problem, reopen on return) are the projection's, so they
 * are proven against it rather than against a fake that could agree with anything.
 */
export interface TestJournal {
  journal: NotificationJournal
  /** The migrated database behind it, for a producer under test that needs its own tables. */
  db: ReturnType<typeof createDatabase>
  /** Every row this user has, keyed by row key, after the queue drained. */
  rows(userId?: string): Promise<Map<string, InboxEntry>>
  close(): Promise<void>
}

export const TEST_USER = 'local-user'

export async function createTestJournal(): Promise<TestJournal> {
  const db = createDatabase()
  await migrateToLatest(db)
  const journal = createNotificationJournal({ db, now: () => 1_000_000 })
  return {
    journal,
    db,
    async rows(userId = TEST_USER) {
      await journal.flush()
      const { changes } = await journal.sync(userId, 0)
      return new Map(
        changes.flatMap((change) => ('entry' in change ? [[change.entry.key, change.entry]] : [])),
      )
    },
    close: () => destroyDatabase(db),
  }
}

/** The open rows only — what the Event Center shows as still wrong. */
export async function openRows(test: TestJournal, userId?: string): Promise<InboxEntry[]> {
  return [...(await test.rows(userId)).values()].filter((entry) => entry.state === 'open')
}
