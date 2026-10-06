import { closeGridTab, useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { useLiveTerminalsStore } from './liveTerminals'
import { forgetTerminalState } from './terminalStates'

function terminalIdOf(item: WorkItem): string | undefined {
  return item.kind === 'terminal' && typeof item.payload?.terminalId === 'string'
    ? item.payload.terminalId
    : undefined
}

/** Retire a confirmed exited PTY, including hidden tabs and the reopen history. */
export function closeDeadTerminalTabs(terminalId: string): void {
  useLiveTerminalsStore.getState().noteFinished(terminalId)
  for (const item of Object.values(useGridStore.getState().items)) {
    if (terminalIdOf(item) !== terminalId) continue
    const sessionId = item.payload?.sessionId
    if (typeof sessionId === 'string') forgetTerminalState(sessionId, terminalId)
    closeGridTab(item.id)
  }
  useGridStore.setState((state) => {
    const closed = state.closed.filter((entry) => terminalIdOf(entry.item) !== terminalId)
    return closed.length === state.closed.length ? state : { closed }
  })
}

/** A successful registry snapshot repairs restored tabs and missed exit events in every scope. */
export async function sweepDeadTerminalTabs(
  shouldApply: () => boolean = () => true,
): Promise<void> {
  const before = useGridStore.getState()
  const candidates = [
    ...Object.values(before.items),
    ...before.closed.map((entry) => entry.item),
  ].filter((item) => terminalIdOf(item))
  if (!candidates.length) return
  const rows = await backendClient.listTerminals()
  if (!shouldApply()) return
  const live = new Set(rows.map((row) => row.id))
  for (const item of candidates) {
    const terminalId = terminalIdOf(item)!
    if (live.has(terminalId)) continue
    const current = useGridStore.getState()
    // A pane opened/replaced while the snapshot was in flight has no death evidence yet.
    if (current.items[item.id] === item || current.closed.some((entry) => entry.item === item))
      closeDeadTerminalTabs(terminalId)
  }
}
