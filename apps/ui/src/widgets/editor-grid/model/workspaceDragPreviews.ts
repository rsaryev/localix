import { setNativeWindowDragImage } from '@localixai/plugin-sdk/ui/message-binding-drag'
import { useGridStore, sessionOfScope } from '@/entities/workspace-grid/model'
import { browserTabTransferBus, type BrowserTabDrag } from '@/shared/lib/browserTabTransferBus'
import { workItemDragBus } from '@/shared/lib/workItemDragBus'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { isDesktopRuntime, IS_MAC } from '@localixai/kit/environment'
import { prepareTabTransfer } from './windowTransferPayload'
import { createProvisionalWindowDrag, type WindowDragPacket } from './provisionalWindowDrag'
import { workspaceDragSnapshot } from './workspaceDragSnapshot'

export const itemDragKey = (id: string) => `item:${id}`
export const pageDragKey = (page: BrowserTabDrag) => `page:${page.sessionId}:${page.pageId}`
export const workspaceDragPreview = createProvisionalWindowDrag({
  invoke: (command, args) => platformCapabilities().desktop.invoke(command, args),
  id: () => crypto.randomUUID(),
})

/** Workbench and Browser tabs share one native gesture; no frame-by-frame renderer IPC. */
export function installWorkspaceDragPreviews(): () => void {
  if (!isDesktopRuntime() || !IS_MAC) return () => {}
  let anchor: [number, number] | undefined
  let dragTransfer: DataTransfer | null = null
  const grabbed = (event: DragEvent) => {
    anchor = [event.clientX, event.clientY]
    dragTransfer = event.dataTransfer
  }
  const released = () => {
    dragTransfer = null
    anchor = undefined
  }
  window.addEventListener('dragstart', grabbed, true)
  window.addEventListener('dragend', released, true)
  const prepare = (key: string, packet: WindowDragPacket) => {
    workspaceDragPreview.begin(key, packet, anchor, workspaceDragSnapshot(packet))
    if (dragTransfer) setNativeWindowDragImage(dragTransfer)
  }
  const begin = () => {
    try {
      const page = browserTabTransferBus.get().drag
      const items = useGridStore.getState().items
      if (page) {
        const browser = Object.values(items).find(
          (item) =>
            item.kind === 'preview' && sessionOfScope(item.scope) === workspaceOf(page.sessionId),
        )
        if (browser) prepare(pageDragKey(page), prepareTabTransfer(browser, page.pageId))
        return
      }
      const id = workItemDragBus.get()?.itemId
      if (id && items[id]) prepare(itemDragKey(id), prepareTabTransfer(items[id]))
    } catch {
      // Unsupported or loading resources still reorder normally in their source strip.
      workspaceDragPreview.cancel()
    }
  }
  const disposers = [workItemDragBus.subscribe(begin), browserTabTransferBus.subscribe(begin)]
  const dropped = () => {
    // Destination handlers synchronously claim a native move. A local reorder
    // leaves the provisional window unclaimed and disposes it in the same turn.
    queueMicrotask(() => workspaceDragPreview.cancel())
  }
  window.addEventListener('drop', dropped, true)
  return () => {
    disposers.forEach((dispose) => dispose())
    window.removeEventListener('drop', dropped, true)
    window.removeEventListener('dragstart', grabbed, true)
    window.removeEventListener('dragend', released, true)
    workspaceDragPreview.cancel()
  }
}
