import { useGridStore, type WorkItem } from '@/features/workspace-grid/model'
import { backendClient } from '@/shared/api/client'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { closeTerminal, createTerminal } from '../api'
import { closeDeadTerminalTabs } from './deadTerminalTabs'
import { makeTerminalItem, placeTerminal } from './terminalTabPlacement'

/** Spawn first: a failed restart must leave the original output available. */
export async function restartTerminalTab(paneId: string): Promise<boolean> {
  if (workItemTransferState.pending(paneId)) return false
  const item = useGridStore.getState().items[paneId]
  const sessionId = item?.payload?.sessionId
  if (
    !item ||
    item.kind !== 'terminal' ||
    typeof sessionId !== 'string' ||
    typeof item.payload?.terminalId !== 'string'
  )
    return false
  if (item.payload?.terminalRestarting) return false
  useGridStore.setState((state) => ({
    items: {
      ...state.items,
      [paneId]: { ...item, payload: { ...item.payload, terminalRestarting: true } },
    },
  }))
  const exit = item.payload?.terminalExit as { command?: string; cwd?: string } | undefined
  const command = exit?.command ?? item.payload?.command
  const cwd = exit?.cwd ?? item.payload?.cwd
  const directory = typeof cwd === 'string' ? { cwd } : {}
  try {
    const terminalId =
      typeof command === 'string'
        ? (await backendClient.spawnTerminalCommand({ sessionId, command, ...directory }))
            .terminalId
        : (await createTerminal({ sessionId, ...directory })).id
    const grid = useGridStore.getState()
    if (!grid.items[paneId]) {
      // The person closed the source tab while spawning; do not leave an orphan.
      await closeTerminal(terminalId)
      return false
    }
    placeTerminal(
      makeTerminalItem({
        sessionId,
        terminalId,
        owned: true,
        title: item.title,
        command: typeof command === 'string' ? command : undefined,
        cwd: directory.cwd,
      }),
    )
    if (typeof item.payload?.terminalId === 'string') closeDeadTerminalTabs(item.payload.terminalId)
    return true
  } catch (err) {
    toast.error('Could not restart the terminal', {
      description: errorMessage(err, '') || undefined,
    })
    return false
  } finally {
    useGridStore.setState((state) => {
      let changed = false
      const clearRestart = (current: WorkItem): WorkItem => {
        if (
          current.id !== paneId ||
          current.payload?.terminalId !== item.payload?.terminalId ||
          !current.payload?.terminalRestarting
        )
          return current
        changed = true
        return {
          ...current,
          payload: {
            ...current.payload,
            terminalRestarting: false,
          },
        }
      }
      const items = Object.fromEntries(
        Object.entries(state.items).map(([id, current]) => [id, clearRestart(current)]),
      )
      const closed = state.closed.map((entry) => {
        const current = clearRestart(entry.item)
        return current === entry.item ? entry : { ...entry, item: current }
      })
      return changed ? { items, closed } : state
    })
  }
}
