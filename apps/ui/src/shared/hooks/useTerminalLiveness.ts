import { useCallback, useEffect, useMemo, useRef } from 'react'

import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { useLiveTerminalsStore } from '@/shared/lib/terminals/liveTerminals'
import {
  replaceTerminalStates,
  useTerminalStatesStore,
} from '@/shared/lib/terminals/terminalStates'

const NO_ROWS: readonly never[] = []

/**
 * WHAT THE SESSION'S TERMINALS ARE DOING — alive, taken over by a full-screen app, serving a URL.
 *
 * Pushed as it happens: an exit is `terminal.finished`, a takeover or a banner URL is
 * `terminal.state`. Those frames are live-only, so the session's terminals are read once when it
 * is opened and again when the socket reconnects. Nothing polls.
 *
 * Answers each terminal's served URL, when it has one.
 */
export function useTerminalLiveness(
  sessionId: string | null,
  isFocused: boolean,
): ReadonlyMap<string, string> {
  const aliveRef = useRef(true)
  // The request a response belongs to: a late answer for another session or focus is dropped,
  // and one already in flight is not sent again (StrictMode runs the effect twice).
  const keyRef = useRef('')
  keyRef.current = `${sessionId ?? ''}:${isFocused}`
  const inFlightRef = useRef<string | null>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  useEffect(() => {
    // No session → no live terminals; clear so stale liveness cannot linger.
    if (isFocused && !sessionId) useLiveTerminalsStore.getState().setIds([])
  }, [sessionId, isFocused])

  const refresh = useCallback(async () => {
    if (!sessionId || !isFocused) return
    const key = `${sessionId}:${isFocused}`
    if (inFlightRef.current === key) return
    inFlightRef.current = key
    const requestedAt = Date.now()
    try {
      const rows = await backendClient.listSessionTerminals(sessionId)
      if (!aliveRef.current || keyRef.current !== key) return
      // ALL live PTY ids (jobs and interactive shells), so transcript cards know which
      // terminals are still alive.
      useLiveTerminalsStore.getState().setIds(rows.map((row) => row.terminalId))
      // Feeds the served URLs below. A takeover opens nothing: the agent shows a terminal itself.
      replaceTerminalStates(sessionId, rows, requestedAt)
    } catch {
      // A transient registry failure must not wipe still-useful state.
    } finally {
      if (inFlightRef.current === key) inFlightRef.current = null
    }
  }, [sessionId, isFocused])

  // The pushed frames are live-only: read on open, and again for what changed while the socket
  // was down.
  useEffect(() => {
    void refresh()
    return eventSocket.onReconnect(() => void refresh())
  }, [refresh])

  const rows = useTerminalStatesStore((s) => (sessionId ? s.bySession[sessionId] : undefined))
  return useMemo(
    () =>
      new Map(
        (rows ?? NO_ROWS).flatMap((row) =>
          row.previewUrl ? [[row.terminalId, row.previewUrl] as const] : [],
        ),
      ),
    [rows],
  )
}
