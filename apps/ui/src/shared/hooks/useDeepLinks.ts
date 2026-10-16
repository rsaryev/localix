import { useLayoutEffect } from 'react'
import { isDesktopRuntime } from '@localixai/kit/environment'
import { parseDeepLink } from '@/shared/lib/deepLink'
import { toast } from '@/shared/lib/notify'
import { tauriInvoke } from '@/shared/lib/tauri'
import { openDeepLinkPath } from '@/shared/lib/openDeepLinkPath'

declare global {
  interface Window {
    /** Installed by useDeepLinks; the Tauri shell calls it with each raw localix:// URL. */
    __localixDeepLink?: (rawUrl: string) => void
  }
}

/**
 * Install the desktop deep-link handler. The Tauri shell forwards each incoming
 * `localix://…` URL into the webview by calling `window.__localixDeepLink(url)`;
 * we map it to a hash route and navigate. Once installed we `invoke` the shell's
 * `deep_link_ready` command so it flushes any COLD-START links (app launched by
 * the OS to service a URL before the webview finished loading). No-op outside the
 * desktop shell.
 */
export function useDeepLinks(): void {
  useLayoutEffect(() => {
    if (!isDesktopRuntime()) return
    // A Finder selection can deliver several paths at once. Finish each workspace
    // handoff before navigating for the next file, so none opens in a retired scope.
    let pending = Promise.resolve()
    window.__localixDeepLink = (rawUrl: string) => {
      const intent = parseDeepLink(rawUrl)
      if (!intent) {
        console.warn('[localix] deep link ignored (unparseable)', rawUrl)
        toast.error('Could not open that link', {
          description: `Localix did not understand ${rawUrl}.`,
        })
        return
      }
      if (intent.kind === 'route') {
        window.location.hash = intent.hash
        return
      }
      // `localix://open?path=…` — resolve the path to a project (create if new),
      // navigate there, and for a file input open a lightweight editor tab.
      pending = pending.then(() => openDeepLinkPath(intent.path))
    }
    tauriInvoke()?.('deep_link_ready').catch(() => {
      /* not the Tauri shell / command absent — ignore */
    })
    return () => {
      delete window.__localixDeepLink
    }
  }, [])
}
