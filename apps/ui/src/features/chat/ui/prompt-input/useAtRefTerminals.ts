import { useEffect, useRef, useState } from 'react'
import { backendClient } from '@/shared/api/client'

export interface AtRefTerminalRow {
  terminalId: string
  command?: string
  cwd: string
}

/**
 * The `@terminal:` picker's rows: the session's live PTYs, fetched fresh on each menu entry.
 * `terminalsSessionRef` names the session the rows belong to (null = none yet), so callers can
 * gate stale rows by owner and reset it when the session changes.
 */
export function useAtRefTerminals(terminalMode: boolean, sessionId: string | null) {
  const [terminals, setTerminals] = useState<AtRefTerminalRow[]>([])
  const terminalsSessionRef = useRef<string | null>(null)
  // Re-entering the picker performs a fresh fetch; do not expose the previous visit's rows.
  if (!terminalMode) terminalsSessionRef.current = null
  useEffect(() => {
    if (!terminalMode || !sessionId) return
    if (terminalsSessionRef.current !== sessionId) setTerminals([])
    let cancelled = false
    void backendClient
      .listSessionTerminals(sessionId)
      .then((rows) => {
        if (!cancelled) {
          terminalsSessionRef.current = sessionId
          setTerminals(rows)
        }
      })
      .catch(() => {
        if (!cancelled) setTerminals([])
      })
    return () => {
      cancelled = true
    }
  }, [terminalMode, sessionId])
  return { terminals, terminalsSessionRef }
}
