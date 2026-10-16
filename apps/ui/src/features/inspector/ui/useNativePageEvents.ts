import { useEffect } from 'react'
import { tauriListen } from '@/shared/lib/tauri'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

interface PageEvent {
  tabId: string
  url?: string
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

function readPageEvent(payload: unknown): PageEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const { tabId, url, title, loading } = payload as Record<string, unknown>
  if (
    typeof tabId !== 'string' ||
    (url !== undefined && typeof url !== 'string') ||
    (title !== undefined && title !== null && typeof title !== 'string') ||
    (loading !== undefined && typeof loading !== 'boolean')
  )
    return null
  return { tabId, url, title, loading }
}

/** What the shell reports about one native page, delivered to the latest handlers. */
export function useNativePageEvents(tabId: string, handlers: NativePageEventHandlers): void {
  const latest = useLatestRef(handlers)
  useEffect(() => {
    const listen = tauriListen()
    if (!listen) return
    const lease = nativePageRendererLease.last(tabId)
    let disposed = false
    let subscriptionFailureReported = false
    const unsubscribers: Array<() => void> = []
    const subscribe = (name: string, handle: (event: PageEvent) => void) => {
      void listen(name, ({ payload }) => {
        if (disposed || (lease && !nativePageRendererLease.current(tabId, lease))) return
        const event = readPageEvent(payload)
        if (event?.tabId === tabId) handle(event)
      })
        .then((off) => {
          if (disposed) off()
          else unsubscribers.push(off)
        })
        .catch((error: unknown) => {
          if (disposed || subscriptionFailureReported) return
          subscriptionFailureReported = true
          toast.error('Could not follow the browser page', {
            description: errorMessage(error, '') || undefined,
          })
        })
    }
    subscribe('browser:navigated', (event) => {
      if (event.url && WEB_URL.test(event.url))
        latest.current.onNavigated(event.url, event.loading === true)
    })
    subscribe('browser:title', (event) => {
      if (event.title) latest.current.onTitle(event.title)
    })
    subscribe('browser:popup', (event) => {
      if (event.url && WEB_URL.test(event.url)) latest.current.onPopup(event.url)
    })
    return () => {
      disposed = true
      for (const off of unsubscribers) off()
    }
  }, [tabId, latest])
}
