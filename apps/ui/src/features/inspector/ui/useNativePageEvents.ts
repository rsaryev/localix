import { useEffect } from 'react'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { nativePageRendererLease } from '@/shared/lib/nativePageRendererLease'
import { useLatestRef } from '@/shared/lib/useLatestRef'
import { toast } from '@/shared/lib/notify'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'

export interface PageEvent {
  tabId: string
  url?: string
  title?: string | null
  loading?: boolean
  /** Sent where the shell observes the page's history (macOS); elsewhere it is asked for. */
  canGoBack?: boolean
  canGoForward?: boolean
}

export interface PageHistory {
  canGoBack: boolean
  canGoForward: boolean
}

export interface NativePageEventHandlers {
  /** The page's address or load state changed: a load started (`loading`) or finished, or the
   *  page moved itself (`history.pushState`). `history` comes along where the shell knows it. */
  onNavigated: (url: string, loading: boolean, history?: PageHistory) => void
  onTitle?: (title: string) => void
  /** The page asked for a new window; it opens as a tab instead. */
  onPopup?: (url: string) => void
}

export const WEB_URL = /^https?:\/\//

const optional = (value: unknown, type: 'string' | 'boolean') =>
  value === undefined || typeof value === type

export function readPageEvent(payload: unknown): PageEvent | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const { tabId, url, title, loading, canGoBack, canGoForward } = payload as Record<string, unknown>
  if (
    typeof tabId !== 'string' ||
    !optional(url, 'string') ||
    (title !== null && !optional(title, 'string')) ||
    !optional(loading, 'boolean') ||
    !optional(canGoBack, 'boolean') ||
    !optional(canGoForward, 'boolean')
  )
    return null
  return {
    tabId,
    url: url as string | undefined,
    title: title as string | null | undefined,
    loading: loading as boolean | undefined,
    canGoBack: canGoBack as boolean | undefined,
    canGoForward: canGoForward as boolean | undefined,
  }
}

/** What the shell reports about one native page, delivered to the latest handlers. */
export function useNativePageEvents(tabId: string, handlers: NativePageEventHandlers): void {
  const latest = useLatestRef(handlers)
  useEffect(() => {
    const listen = platformCapabilities().desktop.listener()
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
      if (!event.url || !WEB_URL.test(event.url)) return
      const history =
        event.canGoBack !== undefined && event.canGoForward !== undefined
          ? { canGoBack: event.canGoBack, canGoForward: event.canGoForward }
          : undefined
      latest.current.onNavigated(event.url, event.loading === true, history)
    })
    subscribe('browser:title', (event) => {
      if (event.title) latest.current.onTitle?.(event.title)
    })
    subscribe('browser:popup', (event) => {
      if (event.url && WEB_URL.test(event.url)) latest.current.onPopup?.(event.url)
    })
    return () => {
      disposed = true
      for (const off of unsubscribers) off()
    }
  }, [tabId, latest])
}
