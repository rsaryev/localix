import { useEffect, useState } from 'react'

import { EmptyHint, LoadingHint } from '@localixai/kit/empty-hint'
import { DbConnectionTab } from './DbConnectionTab'
import { databaseApi } from './api/databaseApi'
import { describeDatabaseFileRejection } from '../shared/database-file'
import type { DbDialect } from './dbClient'

/**
 * A database FILE opened as a database — `localix.db`, a project's `app.sqlite`, a
 * `.sqlite` scratch file — whether it was clicked in the file tree, dropped on the
 * window, or double-clicked in Finder ("Open With → Localix", which arrives as the same
 * `localix://open?path=…` intent every other file open uses).
 *
 * Before this existed, a `.db` had no registered viewer and fell through to the plain
 * code editor, which faithfully rendered the SQLite page format as mojibake. The gap was
 * never in the transport — the file-open flow already reached here — it was that nothing
 * claimed the extension.
 *
 * Two server steps, in this order and no other:
 *
 *   1. PROBE the header. `.db` is not evidence of anything (see `shared/database-file.ts`),
 *      and step 2 SAVES a connection — so guessing wrong would leave a permanent broken
 *      entry in the user's connection list for every stray `.db` they ever clicked.
 *   2. CONNECT. `service.connect` folds a repeat connect onto the existing saved entry with
 *      the same config, so re-opening a file reuses its connection instead of accumulating
 *      one per open. That fold is why this tab can be naive about duplicates.
 *
 * The body is then the ordinary per-connection schema browser — the same component the
 * Database Workspace opens for a saved connection. A database file is not a different
 * KIND of thing once it's open, so it does not get a different UI.
 */

/**
 * In-flight/settled opens, keyed by absolute path. Two tabs on the same file (or React's
 * StrictMode double-effect in development) must produce ONE connect call: the second
 * would race the first through the server's find-or-create and the loser would be a
 * duplicate row. Promise-keyed rather than result-keyed so the dedup covers the window
 * where the first call is still in the air, which is exactly when the race happens.
 */
const opens = new Map<string, Promise<OpenResult>>()

type OpenResult = { ok: true; connectionId: string } | { ok: false; message: string }

async function openDatabaseFile(path: string): Promise<OpenResult> {
  const probe = await databaseApi.probeFile(path)
  if (!probe.openable) return { ok: false, message: describeDatabaseFileRejection(probe.reason) }
  const connection = await databaseApi.connect({
    name: fileName(path),
    config: { dialect: probe.dialect as Extract<DbDialect, 'sqlite'>, file: path },
  })
  return { ok: true, connectionId: connection.id }
}

/** Last path segment — the connection's display name, as the Workspace list shows it. */
function fileName(path: string): string {
  return path.split(/[\\/]/).findLast((segment) => segment !== '') ?? path
}

function openOnce(path: string): Promise<OpenResult> {
  const existing = opens.get(path)
  if (existing) return existing
  const flight = openDatabaseFile(path).catch((err: unknown) => {
    // A failed open must not be cached: the file may have been mid-write, or the server
    // still booting after an OS cold launch. Dropping the entry lets a reopen retry.
    opens.delete(path)
    return { ok: false as const, message: err instanceof Error ? err.message : String(err) }
  })
  opens.set(path, flight)
  return flight
}

/**
 * Open (or reuse) the connection for `path` and report the three states the tab renders.
 * A media-backed file has no path and never reaches here — the contribution declines
 * those, because a database must be a real file the server can hold open.
 */
function useDatabaseFileConnection(path: string) {
  // The path a result belongs to is stored with it. Without that, switching a tab to another
  // file would show the previous database's browser until the new open resolved.
  const [opened, setOpened] = useState<{ path: string; result: OpenResult } | null>(null)

  useEffect(() => {
    if (!path) return
    let alive = true
    void openOnce(path).then((result) => {
      if (alive) setOpened({ path, result })
    })
    return () => {
      alive = false
    }
  }, [path])

  return opened?.path === path ? opened.result : null
}

export function DbFileTab({ path, sessionId }: { path: string; sessionId: string }) {
  const state = useDatabaseFileConnection(path)

  if (!path) return <EmptyHint>This database has no file path to open.</EmptyHint>
  if (!state) return <LoadingHint>Opening {fileName(path)}…</LoadingHint>
  if (!state.ok) return <EmptyHint>{state.message}</EmptyHint>
  return <DbConnectionTab sessionId={sessionId} connectionId={state.connectionId} />
}
