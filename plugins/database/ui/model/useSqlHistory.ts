import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearHistory,
  restoreHistory,
  loadHistory,
  promoteHistory,
  saveHistory,
  togglePin,
  type SqlHistoryEntry,
} from './sqlHistory'

export interface SqlHistoryState {
  entries: SqlHistoryEntry[]
  /** Record a just-run statement (deduped, capped, persisted). */
  record: (sql: string) => void
  /** Pin/unpin a query (favorites survive the cap + sort to the top). */
  togglePin: (sql: string) => void
  /** Clear history — but keep pinned favorites. Returns the revision `restore` must name. */
  clear: () => number
  /**
   * Undo a clear: merge a pre-clear snapshot back in. Queries recorded since the clear are
   * kept, so an undo can never lose newer work.
   *
   * Only the LATEST clear on the SAME connection can be undone; `revision` is what `clear`
   * returned. The Undo lives on a durable Event Center row that stays clickable for a while, so
   * without this a late click re-added statements a second clear had deliberately removed — or,
   * after the console switched connection, merged one connection's queries into another's.
   * Returns false when the undo was stale and nothing changed.
   */
  restore: (snapshot: readonly SqlHistoryEntry[], revision: number) => boolean
}

/** Per-connection SQL history, loaded from + persisted to localStorage. */
export function useSqlHistory(connectionId: string): SqlHistoryState {
  const [entries, setEntries] = useState<SqlHistoryEntry[]>([])
  const revision = useRef(0)

  // Load on mount / connection change. setState is in a callback, not the effect body.
  useEffect(() => {
    // A new connection's list: no earlier clear's undo applies to it.
    revision.current += 1
    let alive = true
    void Promise.resolve(loadHistory(connectionId)).then((loaded) => {
      if (alive) setEntries(loaded)
    })
    return () => {
      alive = false
    }
  }, [connectionId])

  const record = useCallback(
    (sql: string) => {
      setEntries((prev) => {
        const next = promoteHistory(prev, { sql, at: Date.now() })
        saveHistory(connectionId, next)
        return next
      })
    },
    [connectionId],
  )

  const togglePinCb = useCallback(
    (sql: string) => {
      setEntries((prev) => {
        const next = togglePin(prev, sql)
        saveHistory(connectionId, next)
        return next
      })
    },
    [connectionId],
  )

  const clear = useCallback(() => {
    revision.current += 1
    setEntries((prev) => {
      const next = clearHistory(prev)
      saveHistory(connectionId, next)
      return next
    })
    return revision.current
  }, [connectionId])

  const restore = useCallback(
    (snapshot: readonly SqlHistoryEntry[], at: number) => {
      if (at !== revision.current) return false
      // Spent: a second click on the same Undo is a no-op, not a second merge.
      revision.current += 1
      setEntries((prev) => {
        const next = restoreHistory(prev, snapshot)
        saveHistory(connectionId, next)
        return next
      })
      return true
    },
    [connectionId],
  )

  return { entries, record, togglePin: togglePinCb, clear, restore }
}
