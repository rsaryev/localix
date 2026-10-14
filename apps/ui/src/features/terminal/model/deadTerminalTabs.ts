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

export interface TerminalExit {
  exitCode: number | null
  interactive?: boolean
  command?: string
  cwd?: string
}

/**
 * Keep the tab and its output until the person closes it; only a successful explicit shell exit
 * (the person typed `exit`) closes it.
 */
export function finishTerminalTabs(terminalId: string, exit: TerminalExit): void {
  const state = useGridStore.getState()
  const matching = [
    ...Object.values(state.items),
    ...state.closed.map((entry) => entry.item),
  ].filter((item) => terminalIdOf(item) === terminalId)
  const failed = matching.some((item) => {
    const previous = item.payload?.terminalExit as TerminalExit | undefined
    return previous?.exitCode != null && previous.exitCode !== 0
  })
  // A late success/unknown observation cannot erase an already confirmed failure.
  if (failed && (exit.exitCode === null || exit.exitCode === 0)) return
  if (exit.interactive && exit.exitCode === 0) {
    closeDeadTerminalTabs(terminalId)
    return
  }
  useLiveTerminalsStore.getState().noteFinished(terminalId)
  let changed = false
  const update = (item: WorkItem): WorkItem => {
    if (terminalIdOf(item) !== terminalId) return item
    const previous = item.payload?.terminalExit as TerminalExit | undefined
    // An exit with no code (a missed exit found on reconnect) never replaces a known one.
    if (previous && exit.exitCode === null) return item
    const sessionId = item.payload?.sessionId
    if (typeof sessionId === 'string') forgetTerminalState(sessionId, terminalId)
    if (
      previous?.exitCode === exit.exitCode &&
      previous?.interactive === exit.interactive &&
      previous?.command === exit.command &&
      previous?.cwd === exit.cwd
    )
      return item
    changed = true
    return { ...item, payload: { ...item.payload, terminalExit: exit } }
  }
  useGridStore.setState((state) => {
    const items = Object.fromEntries(
      Object.entries(state.items).map(([id, item]) => [id, update(item)]),
    )
    const closed = state.closed.map((entry) => {
      const item = update(entry.item)
      return item === entry.item ? entry : { ...entry, item }
    })
    return changed ? { items, closed } : state
  })
}

/** A successful registry snapshot marks missed exits without discarding their output. */
export async function sweepDeadTerminalTabs(
  shouldApply: () => boolean = () => true,
): Promise<void> {
  const before = useGridStore.getState()
  const candidates = [
    ...Object.values(before.items),
    ...before.closed.map((entry) => entry.item),
  ].filter((item) => terminalIdOf(item) && !item.payload?.terminalExit)
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
      finishTerminalTabs(terminalId, { exitCode: null })
  }
}
