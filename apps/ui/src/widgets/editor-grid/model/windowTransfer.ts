import { isDesktopRuntime, IS_MAC } from '@localixai/kit/environment'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { useGridStore, groupOfTab } from '@/features/workspace-grid/model'
import { closeTabState } from '@/features/workspace-grid/model/itemOps'
import { dropTabFromScopeActive } from '@/features/workspace-grid/model/warm'
import { closeNativePages } from '@/features/inspector/model/nativePages'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { itemDragKey, workspaceDragPreview } from './workspaceDragPreviews'
import {
  prepareTabTransfer,
  tabTransferStillCurrent,
  type TabWindowDestination,
} from './windowTransferPayload'

export const nativeTabTransferAvailable = () => isDesktopRuntime() && IS_MAC

interface OutsideTabDragPort {
  available: () => boolean
  destination: () => Promise<TabWindowDestination | null> | null
}

const outsideTabDragPort: OutsideTabDragPort = {
  available: nativeTabTransferAvailable,
  destination: () =>
    platformCapabilities().desktop.invoke<TabWindowDestination | null>(
      'workspace_tab_drop_destination',
    ),
}

/** A move is committed only when the destination has accepted this tab and its live resources. */
export async function moveTabToWorkspaceWindow(
  id: string,
  destination: TabWindowDestination,
): Promise<boolean> {
  if (!workItemTransferState.begin(id)) return false
  try {
    const item = useGridStore.getState().items[id]
    if (!item) return false
    const { payload, route } = prepareTabTransfer(item)
    const task =
      workspaceDragPreview.claim(itemDragKey(id), { payload, route }, destination) ??
      platformCapabilities().desktop.invoke<string>('workspace_transfer_open', {
        asTab: destination === 'tab',
        route,
        payload,
      })
    if (!task) throw new Error('Moving tabs requires the desktop app')
    await task
    const current = useGridStore.getState().items[id]
    if (!current) return true
    if (!tabTransferStillCurrent(payload, current)) {
      toast.info('The original tab was kept because its content changed while moving')
      return false
    }
    // Publish departure before React cleanup checks ownership of an owned terminal.
    workItemTransferState.finish(id, true)
    useGridStore.setState((state) => {
      const leaf = groupOfTab(state.root, id)
      if (!leaf) return state
      const next = closeTabState(state, leaf.id, id, state.activeScope)
      return {
        ...next,
        closed: state.closed,
        scopeActiveTab: dropTabFromScopeActive(state.scopeActiveTab, id),
      }
    })
    if (payload.browser) {
      closeNativePages(
        payload.browser.tabs.map((tab) => tab.previewId),
        'Could not close the moved Browser pages',
      )
    }
    return true
  } catch (error) {
    toast.error('Could not move the tab', { description: errorMessage(error, '') || undefined })
    return false
  } finally {
    workItemTransferState.finish(id)
  }
}

/** WebKit's dropEffect reflects the OS target, not whether this is a workspace tear-out. */
export async function outsideTabDragDestination(
  event: globalThis.DragEvent | null,
  cancelled: boolean,
  port: OutsideTabDragPort = outsideTabDragPort,
): Promise<TabWindowDestination | null> {
  if (!event || cancelled || !port.available()) return null
  try {
    const destination = await port.destination()
    if (destination === 'tab' || destination === 'window') {
      return destination
    }
  } catch (error) {
    toast.error('Could not find a window destination', {
      description: errorMessage(error, '') || undefined,
    })
  }
  return null
}

export async function finishOutsideTabDrag(
  id: string,
  event: globalThis.DragEvent | null,
  cancelled: boolean,
): Promise<void> {
  const revision = workspaceDragPreview.revision()
  const destination = await outsideTabDragDestination(event, cancelled)
  if (workspaceDragPreview.revision() !== revision) return
  if (destination) await moveTabToWorkspaceWindow(id, destination)
  else workspaceDragPreview.cancel(itemDragKey(id))
}
