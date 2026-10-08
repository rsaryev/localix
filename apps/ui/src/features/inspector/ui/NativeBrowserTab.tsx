import { useCallback, useMemo, useState } from 'react'
import { errorMessage } from '@localixai/plugin-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { tauriInvoke } from '@/shared/lib/tauri'
import { BrowserToolbar } from './BrowserToolbar'
import { NativePageSurface } from './NativePageSurface'
import { useNativeBrowserPage } from './useNativeBrowserPage'
import { useNativePageEvents } from './useNativePageEvents'
import { usePreviewViewport } from './usePreviewViewport'
import { addressDestination } from '../model/browserUrl'
import { usePreviewStore } from '../model/previewStore'
import type { PreviewEntry } from '../model/preview'

interface NavigationState {
  canGoBack: boolean
  canGoForward: boolean
}

/**
 * Report a failed page operation to the Event Center. It used to be a strip above the page that
 * pushed the page down and stayed until the tab closed; the centre keeps the record without
 * taking the page's room.
 */
function reportTo(title: string) {
  // A Tauri invoke rejects with a bare string or an object, never reliably an Error, and
  // `String(reason)` printed the object case as `[object Object]`.
  return (reason: unknown) =>
    toast.error(title, { description: errorMessage(reason, '') || undefined })
}

/** A platform WebKit/WebView2 page. Websites never receive the main app's Tauri capability. */
export function NativeBrowserTab({
  sessionId,
  tab,
  active,
  onOpenElsewhere,
}: {
  /** The chat whose Browser holds this tab — its navigations and popups stay in that strip. */
  sessionId: string
  tab: PreviewEntry
  active: boolean
  /** Open an address this tab's engine does not serve, where a fresh tab for it would go. */
  onOpenElsewhere?: (url: string) => void
}) {
  const [navigation, setNavigation] = useState<NavigationState>({
    canGoBack: false,
    canGoForward: false,
  })
  const [loading, setLoading] = useState(false)
  const updateTab = usePreviewStore((s) => s.updateBrowserTab)
  const invoke = useMemo(() => tauriInvoke(), [])

  const refreshNavigation = useCallback(() => {
    void invoke?.('browser_navigation_state', { tabId: tab.previewId })
      .then((state) => setNavigation(state as NavigationState))
      .catch(() => {})
  }, [invoke, tab.previewId])

  const page = useNativeBrowserPage({
    tabId: tab.previewId,
    url: tab.url,
    active,
    onOpened: refreshNavigation,
    onError: reportTo('Could not show the browser page'),
  })
  // The frame size is remembered on this tab of this chat's strip, like a framed preview's.
  const { viewport, changeViewport } = usePreviewViewport({
    sessionId,
    previewId: tab.previewId,
    initialViewport: tab.viewport,
    backgroundHost: false,
    active,
  })

  useNativePageEvents(tab.previewId, {
    onNavigated: (url, started) => {
      updateTab(sessionId, tab.previewId, { url })
      setLoading(started)
      refreshNavigation()
    },
    onTitle: (title) => updateTab(sessionId, tab.previewId, { title }),
    // A popup opens beside its opener, in the same chat's Browser.
    onPopup: (url) => usePreviewStore.getState().openBrowserTab(sessionId, url),
  })

  const navigate = (url: string) => {
    // A native page only exists in the desktop shell, so its addresses are routed as there.
    if (addressDestination(tab, url, true) === 'elsewhere' && onOpenElsewhere) {
      onOpenElsewhere(url)
      return
    }
    updateTab(sessionId, tab.previewId, { url, title: undefined })
    void invoke?.('browser_navigate', { tabId: tab.previewId, url }).catch(
      reportTo('Could not open the address'),
    )
  }
  const reload = () => {
    void invoke?.('browser_reload', { tabId: tab.previewId }).catch(
      reportTo('Could not reload the page'),
    )
  }
  const go = (direction: 'back' | 'forward') => {
    void invoke?.('browser_go', { tabId: tab.previewId, direction }).catch(
      reportTo(direction === 'back' ? 'Could not go back' : 'Could not go forward'),
    )
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <BrowserToolbar
        url={tab.url}
        onNavigate={navigate}
        onReload={reload}
        onBack={() => go('back')}
        onForward={() => go('forward')}
        canGoBack={navigation.canGoBack}
        canGoForward={navigation.canGoForward}
        loading={loading}
        viewport={{ preset: viewport, onChange: changeViewport }}
      />
      <NativePageSurface page={page} pageId={tab.previewId} url={tab.url} viewport={viewport} />
    </div>
  )
}
