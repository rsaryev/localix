import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'

/**
 * Close the desktop shell's native pages behind Browser tabs that are going away.
 *
 * Dropping a tab from the store does not do it: a mounted page only HIDES its layer on unmount
 * (`nativePageLayer.dispose`), so a page whose tab vanished any other way kept running unseen —
 * playing audio, holding a dev server's socket — until the app quit. Deleting a chat was such a
 * way. Every path that removes tabs closes their pages here, and a refusal is said, because the
 * tabs are already gone and nothing else would show the pages are not.
 */
export function closeNativePages(tabIds: readonly string[], failure: string): void {
  const invoke = platformCapabilities().desktop.invoker()
  if (!invoke || !tabIds.length) return
  const unique = [...new Set(tabIds)].flatMap((id) => {
    const retired = nativePageRendererLease.retire(id)
    return retired ? [{ id, lease: retired.lease }] : []
  })
  const tasks: Promise<unknown>[] = []
  for (let index = 0; index < unique.length; index += 100) {
    const pages = unique.slice(index, index + 100)
    const tabIds = pages.map((page) => page.id)
    const leases: Record<string, string> = {}
    for (const { id, lease } of pages) {
      if (lease) leases[id] = lease
    }
    tasks.push(invoke('browser_close_many', { tabIds, leases }))
  }
  void Promise.all(tasks).catch((error: unknown) =>
    toast.error(failure, { description: errorMessage(error, '') || undefined }),
  )
}
