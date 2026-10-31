/**
 * `back`, `forward`, `reload` — the page moves in its own session history, as the toolbar
 * buttons do. The probe only ASKS the page to go; the next document replaces this one, so its
 * answer cannot describe where the page lands. The hosts do that (a native WebView waits for the
 * incoming document and answers with it), and the first command of the new document is told the
 * page reloaded, so the model re-reads instead of trusting refs from the page it left.
 */
import { fail } from './target'
import type { ActuateDeps, ActuateResult } from './types'

/** The page's navigation, injectable so a test never leaves its own document. */
export interface PageNavigation {
  canGoBack(): boolean
  canGoForward(): boolean
  back(): void
  forward(): void
  reload(): void
}

interface NavigationApi {
  canGoBack?: boolean
  canGoForward?: boolean
}

/**
 * The real page. Where the Navigation API exists it says whether there is anywhere to go; where
 * it does not, the attempt is made and a no-op `history.back()` is all that can happen.
 */
export function pageNavigation(): PageNavigation {
  const api = (): NavigationApi | undefined => (window as { navigation?: NavigationApi }).navigation
  return {
    canGoBack: () => api()?.canGoBack !== false,
    canGoForward: () => api()?.canGoForward !== false,
    back: () => window.history.back(),
    forward: () => window.history.forward(),
    reload: () => window.location.reload(),
  }
}

export function performNavigate(
  action: 'back' | 'forward' | 'reload',
  deps: Pick<ActuateDeps, 'nav'>,
): ActuateResult {
  const nav = deps.nav ?? pageNavigation()
  if (action === 'back' && !nav.canGoBack())
    return fail('failed', "There is no earlier page in this tab's history to go back to.")
  if (action === 'forward' && !nav.canGoForward())
    return fail('failed', "There is no later page in this tab's history to go forward to.")
  nav[action]()
  const note =
    action === 'reload'
      ? 'reloading the page — refs from before are invalid; take a snapshot once it has loaded'
      : `went ${action} in the tab's history — refs from the page left are invalid; take a snapshot once it has loaded`
  return { ok: true, result: { action, note } }
}
