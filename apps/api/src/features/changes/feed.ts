/**
 * A change feed's consuming side: the consumers of one stream, each reading at its own cursor,
 * and the retention of what they all have read. One mechanism, many instances — the core's
 * registry is one stream, a plugin's is another.
 *
 * Producers do not hold a feed: they call `recordChanges` (`record.ts`) in their own transaction
 * and the stream's signal wakes the feed. `record` and `publish` here are the same call for a
 * holder of the feed (tests, a plugin host).
 */
import type { Kysely, Transaction } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { startConsumer, type ChangeConsumer } from './consumer'
import type { Cascades, Change, ConsumerHandlers, EntityRegistry, RefSchemas } from './contracts'
import { onRecorded, recordChanges } from './record'

/** Notices every consumer has read are kept this long before they go. */
const RETENTION_MS = 24 * 60 * 60_000
/** A cursor not moved for this long belongs to a consumer that no longer exists. */
const ABANDONED_CURSOR_MS = 30 * 24 * 60 * 60_000

export function createChangeFeed<R extends RefSchemas, C extends Cascades<R>>(deps: {
  db: Kysely<AppDatabase>
  /** `core`, or `plugin:<name>` for a plugin's own registry. */
  stream: string
  registry: EntityRegistry<R, C>
  log?: (event: string, detail: Record<string, unknown>) => void
}) {
  const { db, stream, registry } = deps
  const consumers = new Map<string, ChangeConsumer>()
  const log = (event: string, detail: Record<string, unknown>) => {
    try {
      deps.log?.(event, { stream, ...detail })
    } catch {
      /* the log sink is closed */
    }
  }
  const unsignal = onRecorded(stream, () => {
    for (const consumer of consumers.values()) consumer.wake()
  })

  return {
    stream,

    /** Record changes in the caller's transaction. Never throws; the caller's write stands. */
    record: (
      trx: Kysely<AppDatabase> | Transaction<AppDatabase>,
      changes: Change<R> | readonly Change<R>[],
    ) => recordChanges<R>(trx, stream, changes),

    /** Announce changes with no transaction of the owner's to join (files). Fire-and-forget. */
    publish(changes: Change<R> | readonly Change<R>[]): void {
      void recordChanges<R>(db, stream, changes)
    },

    /**
     * Start reading as `name`; resolves once its cursor is placed. A new consumer starts past
     * what is already recorded (its own reconcile covers the past) unless `from: 'start'`.
     */
    async subscribe(
      name: string,
      handlers: ConsumerHandlers<R, C>,
      options: { from?: 'now' | 'start' } = {},
    ): Promise<ChangeConsumer> {
      if (consumers.has(name)) throw new Error(`change consumer "${name}" is already subscribed`)
      const consumer = startConsumer({
        db,
        stream,
        name,
        registry,
        handlers,
        from: options.from ?? 'now',
        log,
      })
      consumers.set(name, consumer)
      await consumer.ready
      return consumer
    },

    /** Drop notices every consumer here has read, and cursors no consumer has moved in a month. */
    async prune(now = Date.now()): Promise<number> {
      const abandoned = new Date(now - ABANDONED_CURSOR_MS).toISOString()
      await db
        .deleteFrom('change_cursors')
        .where('stream', '=', stream)
        .where('updated_at', '<', abandoned)
        .execute()
      const cursors = await db
        .selectFrom('change_cursors')
        .select('seq')
        .where('stream', '=', stream)
        .execute()
      if (cursors.length === 0) return 0
      const readByAll = Math.min(...cursors.map((c) => c.seq))
      const result = await db
        .deleteFrom('change_events')
        .where('stream', '=', stream)
        .where('seq', '<=', readByAll)
        .where('recorded_at', '<', new Date(now - RETENTION_MS).toISOString())
        .executeTakeFirst()
      return Number(result.numDeletedRows ?? 0)
    },

    /** Let every consumer catch up with what is recorded (tests, shutdown). */
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 0))
      for (const consumer of consumers.values()) await consumer.settle()
    },

    async close() {
      unsignal()
      for (const consumer of consumers.values()) await consumer.stop()
      consumers.clear()
    },
  }
}

export type ChangeFeed<R extends RefSchemas, C extends Cascades<R>> = ReturnType<
  typeof createChangeFeed<R, C>
>
