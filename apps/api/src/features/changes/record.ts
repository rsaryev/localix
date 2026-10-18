/**
 * The producer's side of the change feed: write a notice, in the producer's own transaction, and
 * nothing else. A producer depends on its registry's types and this function — never on the feed
 * instance or on who consumes — so any module that writes an entity can say so.
 *
 * Never slows or fails the producer: one small INSERT; a failure is caught and logged (SQLite
 * undoes that one statement, the producer's write still commits) and the gap is left to the
 * consumers' reconcile. After the write, the stream's in-process signal wakes its feed; the
 * consumers' read waits behind the producer's transaction, so they see the notice once committed.
 */
import type { Kysely, Transaction } from 'kysely'
import type { AppDatabase } from '../../db/types'
import type { Change, RefSchemas } from './contracts'

type Writer = Kysely<AppDatabase> | Transaction<AppDatabase>
type Log = (event: string, detail: Record<string, unknown>) => void

const signals = new Map<string, Set<() => void>>()
let log: Log | undefined

/** Where record failures are reported (bootstrap sets the server log). */
export function setChangeLog(sink: Log | undefined): void {
  log = sink
}

/** Run `listener` shortly after any notice of `stream` is written. Returns the unsubscribe. */
export function onRecorded(stream: string, listener: () => void): () => void {
  let set = signals.get(stream)
  if (!set) signals.set(stream, (set = new Set()))
  set.add(listener)
  return () => {
    set.delete(listener)
  }
}

function signal(stream: string) {
  for (const listener of signals.get(stream) ?? []) {
    try {
      listener()
    } catch {
      /* one bad listener never fails a producer */
    }
  }
}

/** Record `changes` to `stream` with `writer` (the producer's transaction). Never throws. */
export async function recordChanges<R extends RefSchemas>(
  writer: Writer,
  stream: string,
  changes: Change<R> | readonly Change<R>[],
): Promise<void> {
  const list = (Array.isArray(changes) ? changes : [changes]) as readonly Change<R>[]
  if (list.length === 0) return
  try {
    await writer
      .insertInto('change_events')
      .values(
        list.map((change) => ({
          stream,
          entity: change.entity,
          op: change.op,
          ref_json: change.op === 'resync' ? null : JSON.stringify(change.ref),
        })),
      )
      .execute()
  } catch (error) {
    try {
      log?.('changes.record_failed', { stream, error: String(error) })
    } catch {
      /* the log sink is closed */
    }
    return
  }
  queueMicrotask(() => signal(stream))
}
