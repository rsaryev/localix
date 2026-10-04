import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { tauriInvoke } from '@/shared/lib/tauri'

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
  if (!tabIds.length) return
  void tauriInvoke()?.('browser_close_many', { tabIds: [...tabIds] }).catch((error: unknown) =>
    toast.error(failure, { description: errorMessage(error, '') || undefined }),
  )
}
