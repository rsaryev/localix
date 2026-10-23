import { useCallback, useEffect, useRef, useState } from 'react'
import { draftStoreKey } from '../consoleDraft'

const DEFAULT_SQL = 'SELECT 1;'

function loadDraft(key: string): string {
  try {
    return localStorage.getItem(draftStoreKey(key)) ?? DEFAULT_SQL
  } catch {
    return DEFAULT_SQL
  }
}

/**
 * The console's editor text, optionally persisted under `draftKey` (restored across
 * restarts), plus a ref mirror so stable run callbacks read the latest text without a
 * stale closure.
 */
export function useEditorDraft(draftKey: string | undefined) {
  const [sql, setSqlState] = useState(() => (draftKey ? loadDraft(draftKey) : DEFAULT_SQL))
  // Persist the editor draft on every change when a draftKey is set (small strings).
  const setSql = useCallback(
    (next: string) => {
      setSqlState(next)
      if (draftKey) {
        try {
          localStorage.setItem(draftStoreKey(draftKey), next)
        } catch {
          /* storage full / unavailable — draft persistence is best-effort */
        }
      }
    },
    [draftKey],
  )
  const sqlRef = useRef(sql)
  useEffect(() => {
    sqlRef.current = sql
  }, [sql])
  return { sql, setSql, sqlRef }
}
