/**
 * One consumer's reading loop over its stream: read a small page past its cursor, hand each
 * change to the consumer's handler for that kind (expanding a parent's deletion to its children),
 * then move the cursor. Built never to slow or break anything else:
 *   - it wakes a moment after a write, not during it, and yields to the event loop between pages
 *     (`bun:sqlite` is synchronous: a long read would hold every request behind it);
 *   - a handler that throws is retried with backoff, the cursor held on that change; after a few
 *     attempts the change is skipped and logged, its gap left to the consumer's reconcile;
 *   - a malformed row is skipped, never thrown.
 */
import type { Kysely } from 'kysely'
import type { AppDatabase } from '../../db/types'
import { backoffMs } from '../../lib/backoff'
import type { Cascades, ConsumerHandlers, EntityRegistry, RefSchemas } from './contracts'

const PAGE = 100
/** A burst of writes wakes a consumer once, this long after the first. */
const WAKE_DELAY_MS = 50
/** In case a wake was missed (a write from another connection), look again this often. */
const IDLE_POLL_MS = 30_000
const RETRY = { baseMs: 1000, maxMs: 60_000, jitter: 0.2 }
const MAX_ATTEMPTS = 5

type Row = { seq: number; entity: string; op: string; ref_json: string | null }
type Handler = (delivery: Record<string, unknown>) => Promise<void> | void

export function startConsumer<R extends RefSchemas, C extends Cascades<R>>(deps: {
  db: Kysely<AppDatabase>
  stream: string
  name: string
  registry: EntityRegistry<R, C>
  handlers: ConsumerHandlers<R, C>
  /** Where a consumer with no cursor yet starts: past everything (`now`), or at the start. */
  from: 'now' | 'start'
  log?: (event: string, detail: Record<string, unknown>) => void
}) {
  const { db, stream, name, registry } = deps
  const handlers = deps.handlers as unknown as Record<string, Handler | 'ignore'>
  const cascades = registry.cascades as Record<string, readonly string[] | undefined>
  let cursor: number | null = null
  let attempts = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let running: Promise<void> | null = null
  let stopped = false

  const log = (event: string, detail: Record<string, unknown>) => {
    try {
      deps.log?.(event, { consumer: name, ...detail })
    } catch {
      /* the log sink is closed */
    }
  }

  async function loadCursor(): Promise<number> {
    const row = await db
      .selectFrom('change_cursors')
      .select('seq')
      .where('consumer', '=', name)
      .where('stream', '=', stream)
      .executeTakeFirst()
    if (row) return row.seq
    const start =
      deps.from === 'start'
        ? 0
        : ((
            await db
              .selectFrom('change_events')
              .select((eb) => eb.fn.max('seq').as('max'))
              .where('stream', '=', stream)
              .executeTakeFirst()
          )?.max ?? 0)
    await saveCursor(Number(start))
    return Number(start)
  }

  async function saveCursor(seq: number) {
    const values = { consumer: name, stream, seq, updated_at: new Date().toISOString() }
    await db
      .insertInto('change_cursors')
      .values(values)
      .onConflict((oc) =>
        oc.columns(['consumer', 'stream']).doUpdateSet({ seq, updated_at: values.updated_at }),
      )
      .execute()
  }

  /** The deliveries one row makes: the change itself, and its children's `parent-deleted`. */
  function deliveries(row: Row): Array<{ kind: string; delivery: Record<string, unknown> }> {
    const schema = registry.refs[row.entity as keyof R]
    if (!schema) return []
    if (row.op === 'resync')
      return [{ kind: row.entity, delivery: { entity: row.entity, op: 'resync' } }]
    const parsed = schema.safeParse(row.ref_json ? JSON.parse(row.ref_json) : null)
    if (!parsed.success) return []
    const change = { entity: row.entity, op: row.op, ref: parsed.data }
    const out: Array<{ kind: string; delivery: Record<string, unknown> }> = [
      { kind: row.entity, delivery: change },
    ]
    if (row.op === 'deleted') {
      for (const child of cascades[row.entity] ?? []) {
        out.push({ kind: child, delivery: { entity: child, op: 'parent-deleted', parent: change } })
      }
    }
    return out
  }

  async function deliver(row: Row) {
    let planned: ReturnType<typeof deliveries> = []
    try {
      planned = deliveries(row)
    } catch {
      log('changes.malformed', { seq: row.seq })
    }
    for (const { kind, delivery } of planned) {
      const handler = handlers[kind]
      if (handler && handler !== 'ignore') await handler(delivery)
    }
  }

  /** Read and deliver pages until caught up; on a failure, retry later from the same change. */
  async function run() {
    cursor ??= await loadCursor()
    while (!stopped) {
      const rows = (await db
        .selectFrom('change_events')
        .select(['seq', 'entity', 'op', 'ref_json'])
        .where('stream', '=', stream)
        .where('seq', '>', cursor)
        .orderBy('seq')
        .limit(PAGE)
        .execute()) as Row[]
      if (rows.length === 0) return
      for (const row of rows) {
        try {
          await deliver(row)
          attempts = 0
        } catch (error) {
          attempts += 1
          const message = String(error instanceof Error ? error.message : error)
          if (attempts < MAX_ATTEMPTS) {
            log('changes.consumer_failed', { seq: row.seq, attempts, error: message })
            await saveCursor(cursor)
            return wake(backoffMs(attempts - 1, RETRY))
          }
          // Given up: the gap is the consumer's reconcile's to close.
          log('changes.consumer_skipped', { seq: row.seq, error: message })
          attempts = 0
        }
        cursor = row.seq
      }
      await saveCursor(cursor)
      // Let requests and timers run between pages.
      await new Promise((resolve) => setImmediate(resolve))
    }
  }

  function tick() {
    timer = null
    if (stopped || running) return
    running = run()
      .catch((error: unknown) => {
        log('changes.consumer_failed', { error: String(error) })
        wake(backoffMs(0, RETRY))
      })
      .finally(() => {
        running = null
        if (!stopped && !timer) timer = setTimeout(tick, IDLE_POLL_MS)
        timer?.unref?.()
      })
  }

  /** Read again soon (after a write), or after `delayMs`. */
  function wake(delayMs = WAKE_DELAY_MS) {
    if (stopped) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(tick, delayMs)
    timer.unref?.()
  }

  // The cursor is placed before anything is read, so `from: 'now'` means "past what was
  // recorded before this consumer started".
  const ready = loadCursor().then((seq) => {
    cursor = seq
    wake(0)
  })
  return {
    name,
    ready,
    wake,
    /** Read now, and resolve once caught up with everything recorded so far (tests). */
    async settle() {
      await running
      if (timer) clearTimeout(timer)
      tick()
      await running
    },
    /** The seq read so far, or null before the first read. */
    position: () => cursor,
    async stop() {
      stopped = true
      if (timer) clearTimeout(timer)
      timer = null
      await running
    },
  }
}

export type ChangeConsumer = ReturnType<typeof startConsumer>
