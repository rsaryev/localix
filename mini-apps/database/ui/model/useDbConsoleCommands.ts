import { useEffect, useRef } from 'react'
import { useWorkItemSessionId } from '@localixai/mini-app-sdk/ui/work-item-session'
import { dbConsoleBus, type DbConsoleCommand } from './dbConsoleBus'

/**
 * Subscribe a console tab to its connection's `dbConsoleBus` commands ONCE per
 * connection. The handler is read through a ref so the subscription stays stable even
 * though callers rebuild their handlers every render (`useSqlConsole` returns a fresh
 * object) — without this every render would re-subscribe. Shared by all four console
 * tabs (SQL / kv / document / search), which previously each hand-rolled this pattern.
 *
 * The console listens for ITS chat only (the tab's own session), so a command sent from another
 * chat never lands in it; a console outside any chat has no sender and listens to nothing.
 */
export function useDbConsoleCommands(
  connectionId: string,
  onCommand: (cmd: DbConsoleCommand) => void,
): void {
  const sessionId = useWorkItemSessionId()
  const ref = useRef(onCommand)
  useEffect(() => {
    ref.current = onCommand
  })
  useEffect(() => {
    if (!sessionId) return
    return dbConsoleBus.subscribe(sessionId, connectionId, (cmd) => ref.current(cmd))
  }, [sessionId, connectionId])
}
