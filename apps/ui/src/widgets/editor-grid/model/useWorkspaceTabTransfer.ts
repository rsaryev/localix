import { useEffect, useState } from 'react'
import { useChatStore } from '@/features/chat/model/store'
import { findSessionInState } from '@/features/chat/model/findSession'
import { useGridStore, makeLeaf, GLOBAL_SCOPE, roleForKind } from '@/features/workspace-grid/model'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { DEAD_TERMINAL_RETENTION_MS } from '@/features/terminal/model/deadTerminalTabs'
import { browserEngine } from '@/features/inspector/model/browserUrl'
import {
  workItemTransferReady,
  waitForTransferResources,
  terminalTransferReadyKey,
  browserTransferReadyKey,
  fileTransferReadyKey,
} from '@/shared/lib/workItemTransferReady'
import { nativeTabTransferAvailable } from './windowTransfer'
import { waitForTransferredLayout } from './workspaceTransferLayout'
import {
  canTransferWorkItem,
  readTabTransferPayload,
  restoreTabTransferResources,
  type TabTransferPayload,
} from './windowTransferPayload'

let receiving: Promise<void> | undefined
let prepared = false
const preparedListeners = new Set<() => void>()
const publishPrepared = () => {
  prepared = true
  for (const listener of preparedListeners) listener()
}

function waitForWorkspace(payload: TabTransferPayload): Promise<void> {
  return new Promise((resolve, reject) => {
    const ready = () => {
      const chat = useChatStore.getState()
      const grid = useGridStore.getState()
      return (
        chat.activeProjectId === payload.projectId &&
        (!payload.sessionId ||
          (chat.activeSessionId === payload.sessionId &&
            findSessionInState(chat, payload.sessionId)?.projectId === payload.projectId &&
            grid.activeScope === workspaceOf(payload.sessionId) &&
            !!grid.items[`chat:${payload.sessionId}`])) &&
        canTransferWorkItem(payload.item)
      )
    }
    if (ready()) return resolve()
    const finish = (error?: Error) => {
      clearTimeout(deadline)
      offChat()
      offGrid()
      if (error) reject(error)
      else resolve()
    }
    const check = () => {
      if (ready()) finish()
    }
    const offChat = useChatStore.subscribe(check)
    const offGrid = useGridStore.subscribe(check)
    const deadline = setTimeout(
      () => finish(new Error('The destination workspace did not become ready')),
      15_000,
    )
  })
}

/** The native side retains the packet until ACK, so a StrictMode remount cannot consume it early. */
export async function receiveWorkspaceTabTransfer(
  onPrepared: () => void = () => {},
): Promise<void> {
  const deadline = Date.now() + 18_000
  const invoke = platformCapabilities().desktop.invoke
  const bootstrap = await invoke<{ sourceWindow: string; payload: unknown } | null>(
    'workspace_transfer_take',
  )
  if (!bootstrap) {
    onPrepared()
    return
  }
  const payload = readTabTransferPayload(bootstrap.payload)
  await waitForWorkspace(payload)
  // Workspace readiness includes the route's initial chat→grid layout effect.
  restoreTabTransferResources(payload)
  const resources: string[] = []
  if (payload.item.kind === 'terminal' && typeof payload.item.payload?.terminalId === 'string') {
    resources.push(terminalTransferReadyKey(payload.item.payload.terminalId))
  }
  if (payload.file) resources.push(fileTransferReadyKey(payload.file.sessionId, payload.file.path))
  const page =
    payload.browser?.tabs.find((entry) => entry.previewId === payload.browser?.activeId) ??
    payload.browser?.tabs[0]
  if (page && browserEngine(page) === 'native')
    resources.push(browserTransferReadyKey(page.previewId))
  workItemTransferReady.arm(resources)
  workItemTransferState.protectReceived(payload.item.id)
  try {
    const grid = useGridStore.getState()
    const item =
      payload.item.kind === 'terminal' && payload.item.payload?.terminalExit
        ? {
            ...payload.item,
            payload: {
              ...payload.item.payload,
              terminalExpiresAt: Date.now() + DEAD_TERMINAL_RETENTION_MS,
            },
          }
        : payload.item
    grid.openItem(item, { group: grid.activeGroup })
    const accepted = useGridStore.getState().items[payload.item.id]
    if (!accepted) throw new Error('The destination could not open the transferred tab')
    const group = 'group-root'
    const scope = payload.sessionId ? workspaceOf(payload.sessionId) : GLOBAL_SCOPE
    useGridStore.setState({
      root: makeLeaf(group, [accepted.id], accepted.id, roleForKind(accepted.kind)),
      items: { [accepted.id]: accepted },
      activeGroup: group,
      mru: [group],
      maximizedGroup: null,
      closed: [],
      activeScope: scope,
      warmScopes: [],
      scopeActiveTab: { [scope]: { [group]: [accepted.id] } },
    })
    const mounted = waitForTransferredLayout(accepted.id, deadline - Date.now())
    onPrepared()
    await mounted
    // Hidden WebKit windows throttle animation frames. React's layout ACK exposes
    // the restored pane without waiting for a frame that requires a visible window.
    await invoke('workspace_transfer_presented')
    await waitForTransferResources(resources, deadline - Date.now())
    if (!useGridStore.getState().items[accepted.id])
      throw new Error('The transferred tab was closed')
    await invoke('workspace_transfer_ready')
    workItemTransferState.acceptReceived(accepted.id)
  } catch (error) {
    // A failed destination may remain usable, but it cannot own the source's process.
    if (payload.item.kind === 'terminal')
      useGridStore.setState((state) => {
        const current = state.items[payload.item.id]
        return current
          ? {
              items: {
                ...state.items,
                [current.id]: {
                  ...current,
                  payload: { ...current.payload, owned: false },
                },
              },
            }
          : state
      })
    throw error
  } finally {
    workItemTransferReady.release(resources)
  }
}

export function useWorkspaceTabTransfer(): boolean {
  const [ready, setReady] = useState(() => !nativeTabTransferAvailable() || prepared)
  useEffect(() => {
    if (!nativeTabTransferAvailable()) return
    const markReady = () => setReady(true)
    preparedListeners.add(markReady)
    if (prepared) markReady()
    if (!receiving) {
      workItemTransferState.beginReceiving()
      receiving = receiveWorkspaceTabTransfer(publishPrepared)
        .catch((error: unknown) => {
          if (errorMessage(error, '') === 'Workspace drag was cancelled') return
          toast.error('Could not receive the moved tab', {
            description: errorMessage(error, '') || undefined,
          })
        })
        .finally(() => {
          workItemTransferState.finishReceiving()
          publishPrepared()
        })
    }
    return () => {
      preparedListeners.delete(markReady)
    }
  }, [])
  return ready
}
