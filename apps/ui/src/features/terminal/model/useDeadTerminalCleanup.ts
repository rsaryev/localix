import { useCallback, useEffect, useRef } from 'react'
import { useVisiblePolling } from '@localixai/plugin-sdk/ui/visibility'
import { useGridStore } from '@/features/workspace-grid/model'
import { eventSocket } from '@/shared/api/eventSocket'
import { finishTerminalTabs, sweepDeadTerminalTabs } from './deadTerminalTabs'

/** One workspace-wide sweep: hidden sessions need cleanup without mounting their terminal panes. */
export function useDeadTerminalCleanup(): void {
  const hasTerminals = useGridStore(
    (state) =>
      Object.values(state.items).some((item) => item.kind === 'terminal') ||
      state.closed.some((entry) => entry.item.kind === 'terminal'),
  )
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
  useEffect(() => eventSocket.onReconnect(() => void refresh()), [refresh])
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
  useVisiblePolling({
    enabled: hasTerminals,
    intervalMs: 20_000,
    onTick: refresh,
    immediate: true,
    refreshOnFocus: true,
  })
}
