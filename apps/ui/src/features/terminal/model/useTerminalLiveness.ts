import { useCallback, useEffect, useMemo, useRef } from 'react'

import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { backendClient } from '@/shared/api/client'
import { eventSocket } from '@/shared/api/eventSocket'
import { useLiveTerminalsStore } from './liveTerminals'
import { replaceTerminalStates, useTerminalStatesStore } from './terminalStates'
import { autoRevealFullScreenTerminals } from './terminalTabs'

/**
 * WHAT THE SESSION'S TERMINALS ARE DOING — alive, taken over by a full-screen app, serving a URL.
 *
 * None of that waits on this poll any more: an exit is `terminal.finished`, a takeover or a
 * banner URL is `terminal.state`, both pushed. The poll stays as the BACKSTOP for what has no
 * event — a dev server that printed no banner is found only by scanning the OS's listening ports,
 * which the server does on this request (`ensurePreviewUrls`, an `lsof` pair on macOS) — and for
 * the baseline after a reconnect, since the pushed frames are live-only. So it is slow on
 * purpose; it was 4s while it was the only way to learn anything.
 *
 * Slower still when no terminal is live, and nothing at all in a hidden tab.
 */
const ACTIVE_POLL_INTERVAL_MS = 20_000
const IDLE_POLL_INTERVAL_MS = 60_000

const NO_ROWS: readonly never[] = []

/** Live PTY liveness for one session; answers each terminal's served URL, when it has one. */
export function useTerminalLiveness(
  sessionId: string | null,
  isFocused: boolean,
): ReadonlyMap<string, string> {
  // From the live set, which a `terminal.opened` push seeds — so a first pane started in an idle
  // session moves the backstop to its active cadence without waiting out an idle interval.
  const hasTerminals = useLiveTerminalsStore((s) => s.ids.size > 0)
  const aliveRef = useRef(true)
  const generationRef = useRef(0)

  useEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])
  useEffect(() => {
    generationRef.current += 1
    // No session → no live terminals; clear so stale liveness cannot linger.
    if (isFocused && !sessionId) useLiveTerminalsStore.getState().setIds([])
  }, [sessionId, isFocused])

  const refresh = useCallback(async () => {
    if (!sessionId || !isFocused) return
    const generation = generationRef.current
    const requestedAt = Date.now()
    try {
      const rows = await backendClient.listSessionTerminals(sessionId)
      if (!aliveRef.current || generation !== generationRef.current) return
      // ALL live PTY ids (jobs and interactive shells), so transcript cards know which
      // terminals are still alive.
      useLiveTerminalsStore.getState().setIds(rows.map((row) => row.terminalId))
      // Feeds the served URLs below; a tab-less PTY a full-screen app took over (alt-screen enter)
      // is unusable unseen → adopt and reveal its tab (edge-triggered policy, terminalAutoReveal.ts).
      autoRevealFullScreenTerminals(sessionId, replaceTerminalStates(sessionId, rows, requestedAt))
    } catch {
      // A transient registry failure must not wipe still-useful state; the next poll repairs it.
    }
  }, [sessionId, isFocused])

  // The pushed frames are live-only: what changed while the socket was down is re-read here.
  useEffect(() => eventSocket.onReconnect(() => void refresh()), [refresh])

  useVisiblePolling({
    enabled: !!sessionId && isFocused,
    intervalMs: hasTerminals ? ACTIVE_POLL_INTERVAL_MS : IDLE_POLL_INTERVAL_MS,
    onTick: refresh,
    immediate: true,
    refreshOnFocus: true,
    resetKey: `${sessionId ?? ''}:${isFocused}`,
  })

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
