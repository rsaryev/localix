import { useCallback, useEffect, useRef } from 'react'
import { eventSocket } from '@/shared/api/eventSocket'
import { finishTerminalTabs, sweepDeadTerminalTabs } from './deadTerminalTabs'

/**
 * Mark terminals that ended, workspace-wide: from `terminal.finished` as it happens, and from one
 * registry snapshot when the socket reconnects (the pushed frames are live-only). A finished tab
 * keeps its output until the person closes it; nothing polls and nothing expires it.
 */
export function useDeadTerminalCleanup(): void {
  const active = useRef(false)
  const pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const refresh = useCallback(async () => {
    if (!active.current || pending.current) return
    pending.current = true
    try {
      await sweepDeadTerminalTabs(() => active.current)
    } catch {
      // An unreachable runtime says nothing about whether a terminal is alive.
    } finally {
      pending.current = false
    }
  }, [])
  useEffect(() => {
    void refresh()
    return eventSocket.onReconnect(() => void refresh())
  }, [refresh])
  useEffect(
    () =>
      eventSocket.onSessionEvent((_sessionId, event) => {
        if (event.type === 'terminal.finished')
          finishTerminalTabs(event.terminalId, {
            exitCode: event.exitCode,
            interactive: event.interactive,
            command: event.command,
            cwd: event.cwd,
          })
      }),
    [],
  )
}
