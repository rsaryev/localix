import { useEffect, useState } from 'react'
import { backendClient } from '@/shared/api/client'
import { rowsOwnedBy } from './atRefSuggestions'

export interface AtRefTerminalRow {
  terminalId: string
  command?: string
  cwd: string
}

/** The rows plus the session that produced them (null = none yet). */
interface OwnedTerminals {
  session: string | null
  rows: AtRefTerminalRow[]
}
const NONE: OwnedTerminals = { session: null, rows: [] }

/**
 * The `@terminal:` picker's rows: the session's live PTYs, fetched fresh on each menu entry.
 * The rows are returned already gated by their owner session, so a stale list from another
 * session, or from an earlier visit to the picker, is never exposed.
 */
export function useAtRefTerminals(terminalMode: boolean, sessionId: string | null) {
  const [owned, setOwned] = useState<OwnedTerminals>(NONE)
  // Adjust-during-render: leaving the picker or switching session forgets the previous rows, so
  // re-entering performs a fresh fetch and the previous visit's rows are never exposed.
  const [prevSessionId, setPrevSessionId] = useState(sessionId)
  if (prevSessionId !== sessionId) {
    setPrevSessionId(sessionId)
    setOwned(NONE)
  } else if (!terminalMode && owned !== NONE) {
    setOwned(NONE)
  }
  useEffect(() => {
    if (!terminalMode || !sessionId) return
    let cancelled = false
    void backendClient
      .listSessionTerminals(sessionId)
      .then((rows) => {
        if (!cancelled) setOwned({ session: sessionId, rows })
      })
      .catch(() => {
        if (!cancelled) setOwned((prev) => (prev.rows.length === 0 ? prev : { ...prev, rows: [] }))
      })
    return () => {
      cancelled = true
    }
  }, [terminalMode, sessionId])
  return { terminals: rowsOwnedBy(owned.rows, owned.session, sessionId) }
}
