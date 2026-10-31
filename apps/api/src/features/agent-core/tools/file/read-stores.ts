import { statIfExists } from '@localixai/mini-app-sdk/backend'
import type { FileMtimeStore } from './file-mtime'

/** The session bookkeeping one read writes: the write guard's mtimes. */
export interface ReadStores {
  mtimes: FileMtimeStore
}

/**
 * The session stores, with every WRITE held back until `commit`.
 *
 * A batch reads its items concurrently and decides only afterwards which of them fit the call's
 * budget. An item it then leaves out must leave no trace: a recorded mtime would let `write`
 * overwrite a file the model never saw. So reads see the session's state, and writes land only
 * on commit.
 *
 * The mtime is stat'ed when the item reads, not at commit, so a file changed between the two is
 * still caught by the stale-file guard.
 */
export function stageReadStores(session: ReadStores): ReadStores & { commit(): void } {
  const mtimes = new Map<string, number>()

  const staged: FileMtimeStore = {
    clear: (path) => session.mtimes.clear(path),
    has: (path) => session.mtimes.has(path),
    isStale: (path, currentMtimeMs) => session.mtimes.isStale(path, currentMtimeMs),
    wasInvalidated: (path) => session.mtimes.wasInvalidated(path),
    dispose: () => mtimes.clear(),
    record(path, mtimeMs) {
      mtimes.set(path, mtimeMs)
    },
    async recordNow(path) {
      const st = await statIfExists(path)
      if (st) mtimes.set(path, st.mtimeMs)
    },
  }

  return {
    mtimes: staged,
    commit() {
      for (const [path, mtimeMs] of mtimes) session.mtimes.record(path, mtimeMs)
    },
  }
}
