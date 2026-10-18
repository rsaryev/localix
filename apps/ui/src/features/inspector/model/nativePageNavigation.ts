import { tauriInvoke } from '@/shared/lib/tauri'
import { browserEngine } from './browserUrl'
import type { PreviewEntry } from './preview'

/**
 * Send an existing native page to the address an agent opened again.
 *
 * A target is derived per origin (`previewTabId`), so opening the same site with another path or
 * query lands in the tab already showing it. A framed preview remounts on the new version; a
 * native page is keyed by its tab alone so it keeps its history, and `browser_open` leaves a page
 * that already exists where it is. Without this the address bar showed the new URL while the page
 * stayed on the old one until the person pressed Enter.
 *
 * A page that does not exist yet refuses the navigation; it opens at the tab's new address when
 * it is first shown or driven.
 */
export function navigateReopenedNativePage(
  previous: PreviewEntry | undefined,
  next: PreviewEntry,
  desktop?: boolean,
): void {
  if (!previous || previous.previewId !== next.previewId) return
  if (next.version <= previous.version || browserEngine(previous, desktop) !== 'native') return
  void tauriInvoke()?.('browser_navigate', { tabId: next.previewId, url: next.url }).catch(() => {})
}
