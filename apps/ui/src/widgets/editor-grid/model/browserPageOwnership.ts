import { useGridStore, sessionOfScope, type WorkItem } from '@/features/workspace-grid/model'
import { usePreviewStore } from '@/features/inspector/model/previewStore'
import { closeNativePages } from '@/features/inspector/model/nativePages'
import { workspaceOf } from '@/shared/lib/workspaceOf'

const browserScope = (item: WorkItem): string | null => {
  const session = item.kind === 'preview' ? sessionOfScope(item.scope) : null
  return session ? workspaceOf(session) : null
}

/** Native views follow logical Browser ownership, rather than the lifetime of warm React bodies. */
export function installBrowserPageOwnership(
  close: typeof closeNativePages = closeNativePages,
): () => void {
  const stopGrid = useGridStore.subscribe((next, previous) => {
    if (next.items === previous.items) return
    const remaining = new Set(Object.values(next.items).flatMap((item) => browserScope(item) ?? []))
    const removed = new Set(
      Object.values(previous.items).flatMap((item) => {
        const scope = browserScope(item)
        return scope && !remaining.has(scope) ? [scope] : []
      }),
    )
    if (!removed.size) return
    const previews = usePreviewStore.getState()
    const ids = [...removed].flatMap((scope) =>
      (previews.previewTabsBySession[scope] ?? []).map((tab) => tab.previewId),
    )
    close(ids, 'Could not close the Browser pages')
  })
  const stopPages = usePreviewStore.subscribe((next, previous) => {
    if (next.previewTabsBySession === previous.previewTabsBySession) return
    const remaining = new Set(
      Object.values(next.previewTabsBySession).flatMap((tabs) => tabs.map((tab) => tab.previewId)),
    )
    const removed = Object.values(previous.previewTabsBySession).flatMap((tabs) =>
      tabs.filter((tab) => !remaining.has(tab.previewId)).map((tab) => tab.previewId),
    )
    if (removed.length) close(removed, 'Could not close the removed Browser pages')
  })
  return () => {
    stopGrid()
    stopPages()
  }
}
