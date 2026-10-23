import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from './file-io'
import { createStoreChangeFeed } from './store-change-feed'
import type { z } from 'zod'

/**
 * Durable JSON state for a mini app, kept under `ctx.dataDir` or a session folder.
 *
 * What a person creates must survive a restart, a rebuild and a closed pane, and the agent's
 * tools must see exactly what the view shows. Written ad hoc, that goes wrong in three known ways:
 * two read-modify-writes interleave and one is lost; a crash halfway through `writeFile` leaves a
 * truncated file that never parses again; a file written by an older version fails the new schema
 * and throws at every read. So there is one store per file, and:
 *
 * - `update` runs one change at a time, in order, for EVERY caller in the process. The host calls
 *   `register(ctx)` more than once — for the backend, and again for each run's tools — so the
 *   queue lives at module level, keyed by the file, never in one caller's instance.
 * - A write lands in a sibling file and is renamed over the old one: readers see the old value or
 *   the new one, never half of either.
 * - A missing, unreadable or invalid file reads as `initial`; no reader ever throws.
 */
export interface JsonStore<T> {
  read(): Promise<T>
  /** Apply `change` to the current value, validate it, persist it; resolves to the new value. */
  update(change: (current: T) => T | Promise<T>): Promise<T>
}

const stores = new Map<string, JsonStore<unknown>>()

/**
 * Who hears that a store's file was written: the store feed (`createJsonStoreFeed`), which nudges an
 * open view. Module-level for the same reason as the queue — the tool's write and the view's
 * subscription come from different `register(ctx)` calls — and told only AFTER the rename landed,
 * so a view that re-reads on the nudge can never read the value before it.
 */
const writeListeners = new Set<(path: string) => void>()

/** Hear every write to any store in this process, by the file's path; returns the unsubscribe. */
export function onStoreWrite(listener: (path: string) => void): () => void {
  writeListeners.add(listener)
  return () => {
    writeListeners.delete(listener)
  }
}

export function openJsonStore<T>(options: {
  dir: string
  file: string
  schema: z.ZodType<T>
  initial: T
}): JsonStore<T> {
  const path = join(options.dir, options.file)
  const known = stores.get(path)
  if (known) return known as JsonStore<T>

  let queue: Promise<unknown> = Promise.resolve()
  const load = async (): Promise<T> => {
    try {
      const parsed = options.schema.safeParse(JSON.parse(await readFile(path, 'utf8')))
      return parsed.success ? parsed.data : options.initial
    } catch {
      return options.initial
    }
  }
  // The SDK's write, not a hand-rolled one: a fixed `<file>.<pid>.tmp` is shared by every write
  // in the process, and a failed write left it behind for good. `atomicWriteFile` names each
  // temp uniquely and removes it when the write fails.
  const save = (value: T): Promise<void> =>
    atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`)

  const store: JsonStore<T> = {
    // Behind the queue, so a read never returns the value a pending update is about to replace.
    read: () => queue.then(load),
    update(change) {
      const next = queue.then(async () => {
        const value = options.schema.parse(await change(await load()))
        await save(value)
        for (const listener of writeListeners) {
          try {
            listener(path)
          } catch {
            /* a listener's failure must not fail the write that already landed */
          }
        }
        return value
      })
      queue = next.catch(() => undefined)
      return next
    },
  }
  stores.set(path, store)
  return store
}

/**
 * The change feed for stores opened with `openJsonStore`: a committed write under a followed
 * folder nudges that scope's open view. Feeds filter by folder, so one module-level listener set
 * serves every mini app in the process.
 */
export function createJsonStoreFeed(
  options: Omit<Parameters<typeof createStoreChangeFeed>[0], 'subscribeWrites'>,
): ReturnType<typeof createStoreChangeFeed> {
  return createStoreChangeFeed({ ...options, subscribeWrites: onStoreWrite })
}
