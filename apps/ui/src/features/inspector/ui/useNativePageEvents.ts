import { useEffect } from 'react'
import { tauriListen } from '@/shared/lib/tauri'
import { useLatestRef } from '@/shared/lib/useLatestRef'

interface PageEvent {
  tabId: string
  url: string
  title?: string | null
  loading?: boolean
}

export interface NativePageEventHandlers {
  /** The page started (`loading`) or finished loading an http(s) document. */
  onNavigated: (url: string, loading: boolean) => void
  onTitle: (title: string) => void
  /** The page asked for a new window; it opens as a tab instead. */
  onPopup: (url: string) => void
}

const WEB_URL = /^https?:\/\//

/** What the shell reports about one native page, delivered to the latest handlers. */
export function useNativePageEvents(tabId: string, handlers: NativePageEventHandlers): void {
  const latest = useLatestRef(handlers)
  useEffect(() => {
    const listen = tauriListen()
    if (!listen) return
    let disposed = false
    const unsubscribers: Array<() => void> = []
    const subscribe = (name: string, handle: (event: PageEvent) => void) => {
      void listen(name, ({ payload }) => {
        const event = payload as PageEvent
        if (event.tabId === tabId) handle(event)
      }).then((off) => {
        if (disposed) off()
        else unsubscribers.push(off)
      })
    }
    subscribe('browser:navigated', (event) => {
      if (WEB_URL.test(event.url)) latest.current.onNavigated(event.url, event.loading === true)
    })
    subscribe('browser:title', (event) => {
      if (event.title) latest.current.onTitle(event.title)
    })
    subscribe('browser:popup', (event) => {
      if (WEB_URL.test(event.url)) latest.current.onPopup(event.url)
    })
    return () => {
      disposed = true
      for (const off of unsubscribers) off()
    }
  }, [tabId, latest])
}
