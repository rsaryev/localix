import { useGridStore } from '@/features/workspace-grid/model'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { expireDeadTerminalTabs, finishTerminalTabs, type TerminalExit } from './deadTerminalTabs'

interface ExpiryClock {
  now: () => number
  schedule: (task: () => void, ms: number) => () => void
}

/** One deadline timer for all conversations, including hidden and closed terminal tabs. */
export function startTerminalExpiry(
  clock: ExpiryClock = {
    now: Date.now,
    schedule: (task, ms) => {
      const timer = setTimeout(task, ms)
      return () => clearTimeout(timer)
    },
  },
): () => void {
  let cancel: (() => void) | null = null
  let scheduledAt: number | null = null
  let stopped = false
  let syncing = false
  const sync = () => {
    if (stopped || syncing) return
    syncing = true
    try {
      const state = useGridStore.getState()
      const items = [...Object.values(state.items), ...state.closed.map((entry) => entry.item)]
      // Restore and reopen can add older dead tabs after this service starts. Seed both
      // open tabs and history here; the guard prevents recursive subscription updates.
      for (const item of items) {
        if (
          item.kind === 'terminal' &&
          typeof item.payload?.terminalId === 'string' &&
          item.payload?.terminalExit &&
          !item.payload?.terminalRestarting &&
          !Number.isFinite(item.payload?.terminalExpiresAt)
        )
          finishTerminalTabs(
            item.payload.terminalId,
            item.payload.terminalExit as TerminalExit,
            clock.now(),
          )
      }
      const current = useGridStore.getState()
      const deadlines = [
        ...Object.values(current.items),
        ...current.closed.map((entry) => entry.item),
      ].flatMap((item) =>
        item.kind === 'terminal' &&
        typeof item.payload?.terminalId === 'string' &&
        item.payload?.terminalExit &&
        !item.payload?.terminalRestarting &&
        !workItemTransferState.pending(item.id) &&
        typeof item.payload?.terminalExpiresAt === 'number' &&
        Number.isFinite(item.payload.terminalExpiresAt)
          ? [item.payload.terminalExpiresAt]
          : [],
      )
      const next = deadlines.length ? Math.min(...deadlines) : null
      if (next === scheduledAt) return
      cancel?.()
      cancel = null
      scheduledAt = next
      if (next !== null)
        cancel = clock.schedule(
          () => {
            scheduledAt = null
            cancel = null
            expireDeadTerminalTabs(clock.now())
            sync()
          },
          Math.max(0, next - clock.now()),
        )
    } finally {
      syncing = false
    }
  }
  const stop = useGridStore.subscribe(sync)
  const stopTransfers = workItemTransferState.subscribe(sync)
  sync()
  return () => {
    stopped = true
    stop()
    stopTransfers()
    cancel?.()
  }
}
