// A preview frame that leaves for another site, handed to the native page of its own tab.
//
// In the desktop app a preview is an iframe inside the app's own webview. When that frame heads
// for a non-loopback document (an OAuth provider, which also refuses to be framed), the shell's
// navigation guard cancels it and emits `browser:frame-navigation` with the address
// (`workspace_navigation.rs`). The shell cannot say WHICH frame it was: wry hands its navigation
// handler the URL alone, for the top document and every frame alike. The UI can: the frame the
// person is working in is the window's focused element, so that tab, and only that one, becomes
// the native page at the address — its real origin, where the provider's redirect back to the
// app lands in the same tab. Without a focused preview frame (a link in the app's own UI, a page
// that redirects by itself, an agent's synthesized click) the address goes to the system browser
// after the person agrees, so no page can take over a tab or open windows by itself.
import { errorMessage } from '@localixai/mini-app-sdk/ui/utilities'
import { toast } from '@/shared/lib/notify'
import { platformCapabilities } from '@/shared/lib/platformCapabilities'
import { workspaceOf } from '@/shared/lib/workspaceOf'
import { browserEngine, isLocalBrowserUrl } from './browserUrl'
import { usePreviewStore } from './previewStore'

export const FRAME_NAVIGATION_EVENT = 'browser:frame-navigation'

/** A preview frame on screen and the tab it shows. */
export interface PreviewFrame {
  sessionId: string
  previewId: string
  /** Read when a navigation arrives: the element is replaced on every reload of the page. */
  frame: () => HTMLIFrameElement | null
}

const frames = new Set<PreviewFrame>()

/** Called by a mounted preview tab; the returned function unregisters it. */
export function registerPreviewFrame(entry: PreviewFrame): () => void {
  frames.add(entry)
  return () => {
    frames.delete(entry)
  }
}

/** On Windows the packaged app is served from this host, which no browser page may load. */
function isAppOrigin(hostname: string): boolean {
  return hostname.replace(/\.$/u, '').toLowerCase() === 'tauri.localhost'
}

/**
 * The address a shell event carries, if it is a remote web page. The payload comes from page
 * content, so it is checked again here: HTTP(S) only, never loopback (that stays in the frame)
 * and never the app's own origin.
 */
export function frameNavigationUrl(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const { url } = payload as { url?: unknown }
  if (typeof url !== 'string') return null
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname || isAppOrigin(parsed.hostname)) return null
  if (isLocalBrowserUrl(parsed.href)) return null
  return parsed.href
}

/** The registered frame holding the window's focus: the page the person is working in. */
function focusedFrame(): PreviewFrame | null {
  const focused = document.activeElement
  if (!focused) return null
  for (const entry of frames) {
    if (entry.frame() === focused) return entry
  }
  return null
}

/** Hand a frame's navigation to its tab's native page, or to the system browser. */
export function routeFrameNavigation(url: string): void {
  const owner = focusedFrame()
  const store = usePreviewStore.getState()
  const tab = owner
    ? store.previewTabsBySession[workspaceOf(owner.sessionId)]?.find(
        (entry) => entry.previewId === owner.previewId,
      )
    : undefined
  // The event only exists in the desktop shell, which hosts native pages.
  if (owner && tab && browserEngine(tab, true) === 'frame') {
    store.updateBrowserTab(owner.sessionId, owner.previewId, {
      nativePage: true,
      url,
      title: undefined,
    })
    return
  }
  platformCapabilities().external.open(url, true)
}

/** Follow the shell's frame navigations for this window; returns the stop function. */
export function startPreviewFrameNavigation(): () => void {
  const listen = platformCapabilities().desktop.listener()
  if (!listen) return () => {}
  let stopped = false
  let off: (() => void) | null = null
  void listen(FRAME_NAVIGATION_EVENT, ({ payload }) => {
    if (stopped) return
    const url = frameNavigationUrl(payload)
    if (url) routeFrameNavigation(url)
  })
    .then((unlisten) => {
      if (stopped) unlisten()
      else off = unlisten
    })
    .catch((error: unknown) => {
      // Without the subscription a frame's sign-in page would go nowhere: say so once.
      toast.error('Could not follow the preview’s navigations', {
        description: errorMessage(error, '') || undefined,
      })
    })
  return () => {
    stopped = true
    off?.()
  }
}
