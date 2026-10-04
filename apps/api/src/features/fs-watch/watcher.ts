import { realpathSync } from 'node:fs'
import path from 'node:path'

import { isPathWithin } from '../../lib/path-containment'
import { WATCH_IGNORE_GLOBS } from './ignore'
import { subscribeNative, type NativeWatchEvent } from './subscribe'

/** Coalesce a burst of native events into ONE flush. */
const DEFAULT_QUIET_MS = 250
/**
 * Cap on distinct changed directories enumerated per flush. Past it we collapse to a
 * COARSE signal (`null`) meaning "reload whatever you have open" — a giant churn
 * (branch switch, npm install in a watched tree) shouldn't ship a multi-hundred-entry
 * payload the UI would just reload wholesale anyway.
 */
const MAX_DIRS = 64
/**
 * Cap on distinct changed ENTRIES carried per flush. Separate from (and far above)
 * {@link MAX_DIRS}: the tree reloads wholesale past a few dozen directories, but a consumer that
 * needs the entries themselves (a language server's `didChangeWatchedFiles`) would lose a branch
 * switch entirely if they collapsed at the same point. Past this, `changes` is `null` too.
 */
const MAX_CHANGES = 1024

export type FsChangeType = 'create' | 'update' | 'delete'
/** One changed entry, as the native watcher reported it, mapped onto the watched root. */
export interface FsChange {
  path: string
  type: FsChangeType
}

/**
 * Fold a later event for the same path into the earlier one within ONE flush. A delete followed
 * by a create is an atomic save (write temp, rename over) — the file still exists and changed,
 * so it is an `update`; a create followed by updates is still a `create`. Otherwise the latest
 * event is the state the consumer must learn.
 */
export function foldChange(prev: FsChangeType | undefined, next: FsChangeType): FsChangeType {
  if (prev === 'delete' && next === 'create') return 'update'
  if (prev === 'create' && next === 'update') return 'create'
  return next
}

export interface DirWatcherHandle {
  close(): void
}

/**
 * A single recursive directory watcher over `root`, debounced. On a settled burst it
 * calls `onChange` with the deduped set of ABSOLUTE directory paths whose contents
 * changed, or `null` for the coarse "reload everything visible" signal (overflow), plus
 * the changed ENTRIES with their create/update/delete type (`null` past
 * {@link MAX_CHANGES}). Transport-agnostic — the caller decides how to publish.
 *
 * Runs on the native watcher (`native-binding.ts`), not `fs.watch({ recursive: true })`.
 * Bun's recursive `fs.watch` on macOS delivers only part of a burst: creating three files
 * and a nested folder in one go surfaced three of fourteen changes, and a delete or a
 * rename often none at all — so a file an agent or a terminal created stayed invisible
 * until a manual Refresh. The native watcher reports every create/update/delete, applies
 * the ignore list in the kernel-facing layer (no inotify watch is ever added under an
 * ignored tree), and reports an error instead of going quiet.
 *
 * Any failure — no addon for this platform, a refused subscription (inotify ENOSPC), a
 * runtime error from the backend — reaches `onError`; the caller treats it as "no live
 * watch" and decides when to try again.
 */
export function createDirWatcher(
  root: string,
  onChange: (absDirs: string[] | null, changes: FsChange[] | null) => void,
  opts: { quietMs?: number; onError?: (err: unknown) => void } = {},
): DirWatcherHandle {
  const quietMs = opts.quietMs ?? DEFAULT_QUIET_MS
  let pending = new Set<string>()
  let coarse = false
  let entries = new Map<string, FsChangeType>()
  let entriesOverflow = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let closed = false

  const fail = (err: unknown) => {
    if (!closed) opts.onError?.(err)
  }

  // FSEvents reports REAL paths: a root reached through a symlink (`/tmp` → `/private/tmp`, a
  // linked projects folder) would report every change under a prefix the tree's keys never use,
  // and every refresh would miss. Events are mapped back onto the root as the tree knows it —
  // the correction needed whenever the watch path's real path differs. The REAL root
  // is also what gets subscribed: the native ignore globs match relative to the subscribed
  // path, so a symlinked one would compare real event paths against a prefix they never have
  // and ignore nothing.
  let realRoot = root
  try {
    realRoot = realpathSync(root)
  } catch {
    /* a missing root fails the subscription below, which reports it */
  }

  const flush = () => {
    timer = null
    if (closed) return
    const changes = entriesOverflow
      ? null
      : [...entries].map(([changed, type]): FsChange => ({ path: changed, type }))
    const dirs = coarse ? null : [...pending]
    pending = new Set()
    coarse = false
    entries = new Map()
    entriesOverflow = false
    // A coarse signal (`null`) or a non-empty list; an empty list is nothing to report.
    if (dirs?.length !== 0) onChange(dirs, changes)
  }

  const schedule = () => {
    if (timer || closed) return
    timer = setTimeout(flush, quietMs)
  }

  const toTreePath = (eventPath: string): string | null => {
    if (isPathWithin(realRoot, eventPath)) return root + eventPath.slice(realRoot.length)
    return isPathWithin(root, eventPath) ? eventPath : null
  }

  const record = (events: NativeWatchEvent[]) => {
    for (const event of events) {
      if (coarse && entriesOverflow) break
      const changed = toTreePath(event.path)
      if (!changed || changed === root) continue
      if (!entriesOverflow) {
        entries.set(changed, foldChange(entries.get(changed), event.type))
        if (entries.size > MAX_CHANGES) entriesOverflow = true
      }
      if (coarse) continue
      // The changed entry's PARENT is the listing that gained, lost or re-sorted a row; the
      // entry itself is added too because, when it is a directory, its own listing is what
      // changed (a path that is a file is never a tree key, so that one is a no-op for the UI).
      pending.add(path.dirname(changed))
      pending.add(changed)
      if (pending.size > MAX_DIRS) coarse = true
    }
    schedule()
  }

  const subscription = subscribeNative(realRoot, record, {
    ignore: [...WATCH_IGNORE_GLOBS],
    onError: fail,
  })

  return {
    close() {
      closed = true
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      subscription.close()
    },
  }
}
