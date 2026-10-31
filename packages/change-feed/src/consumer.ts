/**
 * One consumer's reading loop over its stream: read a small page past its cursor, hand each
 * change to the consumer's handler for that kind (expanding a parent's deletion to its children),
 * then move the cursor. Built never to slow or break anything else:
 *   - it wakes a moment after a write, not during it, and yields to the event loop between pages
 *     (`bun:sqlite` is synchronous: a long read would hold every request behind it);
 *   - a handler that throws is retried after the host's delay, the cursor held on that change;
 *     after a few attempts the change is kept as a dead letter, the consumer moves on, and its
 *     reconcile runs to cover the gap;
 *   - a malformed row is skipped, never thrown.
 */
import type { Kysely } from 'kysely'
import type {
  Cascades,
  ConsumerHandlers,
  ConsumerHealth,
  ConsumerOptions,
  EntityRegistry,
  RefSchemas,
} from './contracts'
import { cursorStore, headOf } from './cursor'
import { deadLetterStore, type DeadLetter } from './dead-letters'
import { plannedDeliveries, type NoticeRow, type PlannedDelivery } from './deliveries'
import type { ChangeFeedTables } from './tables'
import { realTimers, type ConsumerTimers } from './timers'

const PAGE = 100
/** A burst of writes wakes a consumer once, this long after the first. */
const WAKE_DELAY_MS = 50
const MAX_ATTEMPTS = 5

type Handler = (delivery: Record<string, unknown>) => Promise<void> | void
type Log = (event: string, detail: Record<string, unknown>) => void

const message = (error: unknown) => String(error instanceof Error ? error.message : error)

export function startConsumer<R extends RefSchemas, C extends Cascades<R>>(deps: {
  db: Kysely<ChangeFeedTables>
  stream: string
  name: string
  registry: EntityRegistry<R, C>
  handlers: ConsumerHandlers<R, C>
  options: ConsumerOptions
  /** The wait before retry number `attempt` (0-based) of a failed delivery. */
  retryDelayMs: (attempt: number) => number
  log?: Log
  timers?: ConsumerTimers
}) {
  const { db, stream, name, registry, options } = deps
  const timers = deps.timers ?? realTimers
  const handlers = deps.handlers as unknown as Record<string, Handler | 'ignore'>
  const dead = deadLetterStore(db, name, stream)
  const cursors = cursorStore(db, name, stream)
  let cursor: number | null = null
  let attempts = 0
  let lastError: ConsumerHealth['lastError'] = null
  let reconcilePending = false
  let timer: unknown = null
  let running: Promise<void> | null = null
  /** A wake arrived while a run was in hand: its notice may be past that run's last read. */
  let again = false
  let paused = false
  let stopped = false

  const log: Log = (event, detail) => {
    try {
      deps.log?.(event, { consumer: name, ...detail })
    } catch {
      /* the log sink is closed */
    }
  }
  const failed = (error: unknown, seq: number | null) => {
    lastError = { message: message(error), seq, at: new Date().toISOString() }
  }

  /** The stored cursor, or a new one: a new consumer also reconciles what came before it. */
  async function loadCursor(): Promise<number> {
    const stored = await cursors.load()
    if (stored !== null) return stored
    const start = options.from === 'start' ? 0 : await headOf(db, stream)
    await cursors.save(start)
    if (options.reconcile) reconcilePending = true
    return start
  }

  async function deliver(row: NoticeRow) {
    let planned: PlannedDelivery[] = []
    try {
      planned = plannedDeliveries(registry, row)
    } catch {
      log('changes.malformed', { seq: row.seq })
    }
    for (const { kind, delivery } of planned) {
      const handler = handlers[kind]
      if (handler && handler !== 'ignore') await handler(delivery)
    }
  }

  async function reconcile() {
    if (!options.reconcile) return
    await options.reconcile()
    reconcilePending = false
  }

  /** Read and deliver pages until caught up; on a failure, retry later from the same change. */
  async function run() {
    cursor ??= await loadCursor()
    if (reconcilePending) {
      try {
        await reconcile()
      } catch (error) {
        failed(error, null)
        log('changes.reconcile_failed', { error: message(error) })
        return wake(deps.retryDelayMs(0))
      }
    }
    while (!stopped && !paused) {
      const rows = (await db
        .selectFrom('change_events')
        .select(['seq', 'entity', 'op', 'ref_json'])
        .where('stream', '=', stream)
        .where('seq', '>', cursor)
        .orderBy('seq')
        .limit(PAGE)
        .execute()) as NoticeRow[]
      if (rows.length === 0) return
      for (const row of rows) {
        try {
          await deliver(row)
          attempts = 0
        } catch (error) {
          attempts += 1
          failed(error, row.seq)
          if (attempts < MAX_ATTEMPTS) {
            log('changes.consumer_failed', { seq: row.seq, attempts, error: message(error) })
            await cursors.save(cursor)
            return wake(deps.retryDelayMs(attempts - 1))
          }
          // Given up: kept to replay, and the consumer's reconcile covers the gap meanwhile.
          log('changes.consumer_skipped', { seq: row.seq, error: message(error) })
          await dead.put({ ...row, error: message(error) })
          attempts = 0
          if (options.reconcile) reconcilePending = true
        }
        cursor = row.seq
      }
      await cursors.save(cursor)
      if (reconcilePending) return wake(0)
      // Let requests and timers run between pages.
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  function tick() {
    timer = null
    if (stopped || paused) return
    if (running) {
      again = true
      return
    }
    running = run()
      .catch((error: unknown) => {
        failed(error, null)
        log('changes.consumer_failed', { error: message(error) })
        wake(deps.retryDelayMs(0))
      })
      .finally(() => {
        running = null
        // Caught up: nothing is armed until a write wakes it. A wake heard during the run reads
        // again now, unless a retry is armed (it reads anyway).
        if (again && timer === null) wake(0)
        again = false
      })
  }

  function disarm() {
    if (timer !== null) timers.clear(timer)
    timer = null
  }

  /** Read again soon (after a write), or after `delayMs`. */
  function wake(delayMs = WAKE_DELAY_MS) {
    if (stopped || paused) return
    disarm()
    timer = timers.set(tick, delayMs)
  }

  /** Stop reading and wait for the page in hand, so a rebuild or replay has the consumer alone. */
  async function pause() {
    paused = true
    disarm()
    await running
  }

  function resume() {
    paused = false
    wake(0)
  }

  // The cursor is placed before anything is read, so `from: 'now'` means "past what was
  // recorded before this consumer started".
  const ready = loadCursor().then((seq) => {
    cursor = seq
    wake(0)
  })

  return {
    name,
    kind: options.kind,
    ready,
    wake,

    /** Read now, and resolve once caught up with everything recorded so far (tests). */
    async settle() {
      await running
      disarm()
      tick()
      await running
    },

    /** The seq read so far, or null before the first read. */
    position: () => cursor,

    async health(): Promise<ConsumerHealth> {
      return {
        name,
        kind: options.kind,
        position: cursor,
        attempts,
        lastError,
        deadLetters: await dead.count(),
      }
    },

    deadLetters: (): Promise<DeadLetter[]> => dead.list(),

    /** Deliver the kept notices again, oldest first; stops at the first that still fails. */
    async replayDeadLetters(): Promise<{ replayed: number; remaining: number }> {
      await pause()
      let replayed = 0
      try {
        for (const letter of await dead.list()) {
          try {
            await deliver(letter)
          } catch (error) {
            failed(error, letter.seq)
            await dead.put({ ...letter, error: message(error) })
            break
          }
          await dead.remove(letter.seq)
          replayed += 1
        }
      } finally {
        resume()
      }
      return { replayed, remaining: await dead.count() }
    },

    /**
     * Drop a projector's derived data and derive it again: the cursor moves to the head first, so
     * a change made while the reconcile runs is delivered after it, which is harmless.
     */
    async rebuild(): Promise<void> {
      if (options.kind !== 'projector') throw new Error(`consumer "${name}" is not a projector`)
      if (!options.reset || !options.reconcile)
        throw new Error(`projector "${name}" needs reset and reconcile to rebuild`)
      await ready
      await pause()
      try {
        await options.reset()
        cursor = await headOf(db, stream)
        await cursors.save(cursor)
        attempts = 0
        await reconcile()
      } finally {
        resume()
      }
    },

    async stop() {
      stopped = true
      disarm()
      await running
    },
  }
}

export type ChangeConsumer = ReturnType<typeof startConsumer>
