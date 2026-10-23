/**
 * A change feed's consuming side: the consumers of one stream, each reading at its own cursor,
 * and the retention of what they all have read. One mechanism, many instances — the core's
 * registry is one stream, a mini app's is another.
 *
 * Producers do not hold a feed: they call `recordChanges` (`record.ts`) in their own transaction
 * and the stream's signal wakes the feed. `record` and `publish` here are the same call for a
 * holder of the feed (tests, a mini app host).
 */
import type { Kysely } from 'kysely'
import { startConsumer, type ChangeConsumer, type ConsumerTimers } from './consumer'
import { headOf } from './cursor'
import type {
  Cascades,
  Change,
  ConsumerHandlers,
  ConsumerHealth,
  ConsumerOptions,
  EntityRegistry,
  RefSchemas,
} from './contracts'
import { onRecorded, recordChanges } from './record'
import { feedTables, type ChangeFeedTables, type ChangeFeedWriter } from './tables'

/** Notices every consumer has read are kept this long before they go. */
const RETENTION_MS = 24 * 60 * 60_000
/** A cursor not moved for this long belongs to a consumer that no longer exists. */
const ABANDONED_CURSOR_MS = 30 * 24 * 60 * 60_000

interface FeedDeps<R extends RefSchemas, C extends Cascades<R>> {
  /** `core`, or `mini-app:<name>` for a mini app's own registry. */
  stream: string
  registry: EntityRegistry<R, C>
  /** The wait before retry number `attempt` (0-based) of a failed delivery. */
  retryDelayMs: (attempt: number) => number
  log?: (event: string, detail: Record<string, unknown>) => void
  /** The consumers' wake and retry timers (tests). */
  timers?: ConsumerTimers
}

/** One stream's feed over any database that has the feed's tables. */
export function createChangeFeed<
  R extends RefSchemas,
  C extends Cascades<R>,
  DB extends ChangeFeedTables,
>(deps: FeedDeps<R, C> & { db: Kysely<DB> }) {
  return feedOver<R, C>({ ...deps, db: feedTables(deps.db) })
}

function feedOver<R extends RefSchemas, C extends Cascades<R>>(
  deps: FeedDeps<R, C> & { db: Kysely<ChangeFeedTables> },
) {
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
    record: <DB extends ChangeFeedTables>(
      trx: ChangeFeedWriter<DB>,
      changes: Change<R> | readonly Change<R>[],
    ) => recordChanges<R, DB>(trx, stream, changes),

    /** Announce changes with no transaction of the owner's to join (files). Fire-and-forget. */
    publish(changes: Change<R> | readonly Change<R>[]): void {
      void recordChanges<R, ChangeFeedTables>(db, stream, changes)
    },

    /**
     * Start reading as `name`; resolves once its cursor is placed. A new consumer starts past
     * what is already recorded, and its reconcile covers the past, unless `from: 'start'`.
     */
    async subscribe(
      name: string,
      handlers: ConsumerHandlers<R, C>,
      options: ConsumerOptions,
    ): Promise<ChangeConsumer> {
      if (consumers.has(name)) throw new Error(`change consumer "${name}" is already subscribed`)
      const consumer = startConsumer({
        db,
        stream,
        name,
        registry,
        handlers,
        options,
        retryDelayMs: deps.retryDelayMs,
        log,
        timers: deps.timers,
      })
      // A stopped consumer leaves, so its name can be subscribed again (a mini app reloaded).
      const stop = () => consumer.stop()
      const handle: ChangeConsumer = {
        ...consumer,
        async stop() {
          if (consumers.get(name) === handle) consumers.delete(name)
          await stop()
        },
      }
      consumers.set(name, handle)
      await consumer.ready
      return handle
    },

    /** Every consumer here, with how far it is behind the newest notice. */
    async health(): Promise<Array<ConsumerHealth & { lag: number | null }>> {
      const newest = await headOf(db, stream)
      return Promise.all(
        [...consumers.values()].map(async (consumer) => {
          const state = await consumer.health()
          return {
            ...state,
            lag: state.position === null ? null : Math.max(0, newest - state.position),
          }
        }),
      )
    },

    /**
     * Drop notices every consumer has read, and the cursor and dead letters of a consumer that is
     * not running here and has not moved in a month.
     */
    async prune(now = Date.now()): Promise<number> {
      const abandonedSince = new Date(now - ABANDONED_CURSOR_MS).toISOString()
      const abandoned = (
        await db
          .selectFrom('change_cursors')
          .select('consumer')
          .where('stream', '=', stream)
          .where('updated_at', '<', abandonedSince)
          .execute()
      )
        .map((row) => row.consumer)
        .filter((name) => !consumers.has(name))
      if (abandoned.length > 0) {
        for (const table of ['change_cursors', 'change_dead_letters'] as const) {
          await db
            .deleteFrom(table)
            .where('stream', '=', stream)
            .where('consumer', 'in', abandoned)
            .execute()
        }
      }
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
  typeof feedOver<R, C>
>
