import { useGridStore, sessionOfScope } from '@/features/workspace-grid/model'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { closeTab as closePreviewPage } from '@/features/inspector/model/preview'
import { closeNativePages } from '@/features/inspector/model/nativePages'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { workItemTransferState } from '@/shared/lib/workItemTransferState'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import {
  browserTabTransferBus,
  type BrowserTabDrag,
  type BrowserTabTransferDestination,
} from '@/shared/lib/browserTabTransferBus'
import { nativeTabTransferAvailable, outsideTabDragDestination } from './windowTransfer'
import { prepareTabTransfer, tabTransferStillCurrent } from './windowTransferPayload'
import { pageDragKey, workspaceDragPreview } from './workspaceDragPreviews'

/** Move only the selected web page; its source Browser and all other pages stay open. */
export async function moveBrowserPageToWindow(
  page: BrowserTabDrag,
  destination: BrowserTabTransferDestination,
): Promise<boolean> {
  const scope = workspaceOf(page.sessionId)
  const browser = Object.values(useGridStore.getState().items).find(
    (item) => item.kind === 'preview' && sessionOfScope(item.scope) === scope,
  )
  if (!browser || !workItemTransferState.begin(browser.id)) return false
  browserTabTransferBus.setPending(page.pageId, true)
  try {
    const { payload, route } = prepareTabTransfer(browser, page.pageId)
    const task =
      workspaceDragPreview.claim(pageDragKey(page), { payload, route }, destination) ??
      platformCapabilities().desktop.invoke<string>('workspace_transfer_open', {
        asTab: destination === 'tab',
        route,
        payload,
      })
    if (!task) throw new Error('Moving pages requires the desktop app')
    await task
    const current = useGridStore.getState().items[browser.id]
    if (!current || !tabTransferStillCurrent(payload, current)) {
      toast.info('The original page was kept because it changed while moving')
      return false
    }
    usePreviewStore.setState((state) => closePreviewPage(state, scope, page.pageId) ?? state)
    closeNativePages([page.pageId], 'Could not close the moved Browser page')
    return true
  } catch (error) {
    toast.error('Could not move the Browser page', {
      description: errorMessage(error, '') || undefined,
    })
    return false
  } finally {
    browserTabTransferBus.setPending(page.pageId, false)
    workItemTransferState.finish(browser.id)
  }
}

export function installBrowserPageWindowTransfers(): () => void {
  return browserTabTransferBus.register({
    available: nativeTabTransferAvailable,
    move: moveBrowserPageToWindow,
    finishOutside: async (page, event, cancelled) => {
      const revision = workspaceDragPreview.revision()
      const destination = await outsideTabDragDestination(event, cancelled)
      if (workspaceDragPreview.revision() !== revision) return
      if (destination) await moveBrowserPageToWindow(page, destination)
      else workspaceDragPreview.cancel(pageDragKey(page))
    },
  })
}
