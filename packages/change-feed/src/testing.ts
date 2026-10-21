/**
 * Test kit for consumers: an in-memory SQLite database with the feed's tables, and a feed over it
 * whose retries wait for the test. A consumer's own tests use it to show the rules every consumer
 * keeps: a notice delivered twice changes nothing, a gap is closed by its reconcile, and a parent's
 * deletion reaches its children's handlers.
 */
import { Database } from 'bun:sqlite'
import { Kysely, sql, SqliteDialect } from 'kysely'
import type { Cascades, EntityRegistry, RefSchemas } from './contracts'
import { createChangeFeed } from './feed'
import type { ChangeFeedTables } from './tables'

/** The feed's tables, as the host's migration creates them. */
const SCHEMA = [
  `CREATE TABLE change_events (
    seq integer primary key autoincrement,
    stream text not null,
    entity text not null,
    op text not null check (op in ('upserted', 'deleted', 'resync')),
    ref_json text,
    recorded_at text default (strftime('%Y-%m-%dT%H:%M:%fZ','now')) not null
  )`,
  'CREATE INDEX change_events_by_stream ON change_events (stream, seq)',
  `CREATE TABLE change_cursors (
    consumer text not null,
    stream text not null,
    seq integer not null,
    updated_at text not null,
    primary key (consumer, stream)
  )`,
  `CREATE TABLE change_dead_letters (
    consumer text not null,
    stream text not null,
    seq integer not null,
    entity text not null,
    op text not null,
    ref_json text,
    error text not null,
    failed_at text not null,
    primary key (consumer, stream, seq)
  )`,
]

/** An in-memory database with the feed's tables. */
export async function createTestDatabase(): Promise<Kysely<ChangeFeedTables>> {
  const sqlite = new Database(':memory:', { strict: true })
  const db = new Kysely<ChangeFeedTables>({
    dialect: new SqliteDialect({
      database: {
        close: () => sqlite.close(false),
        prepare(text: string) {
          const statement = sqlite.prepare(text)
          return {
            reader: statement.columnNames.length > 0,
            all: (parameters: ReadonlyArray<unknown>) => statement.all(...(parameters as never[])),
            run: (parameters: ReadonlyArray<unknown>) => statement.run(...(parameters as never[])),
            iterate: (parameters: ReadonlyArray<unknown>) =>
              statement.iterate(...(parameters as never[])),
          }
        },
      },
    }),
  })
  for (const statement of SCHEMA) await sql.raw(statement).execute(db)
  return db
}

/**
 * A feed for one test stream with the log collected. A failed delivery is retried only when the
 * test settles the consumer again, never on a timer, so a test can observe the state in between.
 */
export async function createFeedTestbed<R extends RefSchemas, C extends Cascades<R>>(
  registry: EntityRegistry<R, C>,
  stream = 'test',
) {
  const db = await createTestDatabase()
  const logged: string[] = []
  const feed = createChangeFeed({
    db,
    stream,
    registry,
    retryDelayMs: () => 60 * 60_000,
    log: (event) => logged.push(event),
  })
  return { db, feed, logged }
}
