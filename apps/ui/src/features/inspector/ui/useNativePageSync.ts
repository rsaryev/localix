import { useEffect } from 'react'
import { tauriListen } from '@/shared/lib/tauri'
import { usePreviewStore } from '../model/previewStore'
import type { PreviewEntry } from '../model/preview'
import { readPageEvent, WEB_URL, type PageEvent } from './useNativePageEvents'

/** The chat whose Browser strip holds a tab, and the tab as stored there. */
function findTab(tabId: string): { sessionId: string; tab: PreviewEntry } | null {
  const strips = usePreviewStore.getState().previewTabsBySession
  for (const [sessionId, tabs] of Object.entries(strips)) {
    const tab = tabs.find((entry) => entry.previewId === tabId)
    if (tab) return { sessionId, tab }
  }
  return null
}

function followAddress(event: PageEvent): void {
  if (!event.url || !WEB_URL.test(event.url)) return
  const found = findTab(event.tabId)
  if (!found || found.tab.url === event.url) return
  // A page keeps its engine wherever it goes: a redirect to a local address (an OAuth callback)
  // must not hand the live page to the frame, which would load it a second time.
  usePreviewStore
    .getState()
    .updateBrowserTab(found.sessionId, event.tabId, { url: event.url, nativePage: true })
}

/**
 * Keep every native tab's address, title and popups in its strip, whether or not its page is on
 * screen.
 *
 * These used to be followed by the mounted tab alone. A page the agent drove while its tab was
 * hidden moved on, and its tab still named the old address when shown, because showing an
 * existing page does not reopen it. The mounted tab now follows only what it draws itself: the
 * loading bar and back/forward (`NativeBrowserTab`).
 */
export function useNativePageSync(): void {
  useEffect(() => {
    const listen = tauriListen()
    if (!listen) return
    let disposed = false
    const unsubscribers: Array<() => void> = []
    const subscribe = (name: string, handle: (event: PageEvent) => void) => {
      void listen(name, ({ payload }) => {
        if (disposed) return
        const event = readPageEvent(payload)
        if (event) handle(event)
      })
        .then((off) => {
          if (disposed) off()
          else unsubscribers.push(off)
        })
        // The mounted tab reports a failed subscription; this one has no surface of its own.
        .catch(() => {})
    }
    subscribe('browser:navigated', followAddress)
    subscribe('browser:title', (event) => {
      // Off macOS a route change is not reported as a navigation, but most apps retitle the page
      // with it, and the title event carries the address the page is at.
      followAddress(event)
      const found = event.title ? findTab(event.tabId) : null
      if (found && found.tab.title !== event.title)
        usePreviewStore
          .getState()
          .updateBrowserTab(found.sessionId, event.tabId, { title: event.title ?? undefined })
    })
    subscribe('browser:popup', (event) => {
      const found = event.url && WEB_URL.test(event.url) ? findTab(event.tabId) : null
      // A popup opens beside its opener, in the same chat's Browser.
      if (found && event.url) usePreviewStore.getState().openBrowserTab(found.sessionId, event.url)
    })
    return () => {
      disposed = true
      for (const off of unsubscribers) off()
    }
  }, [])
}
