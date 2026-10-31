/**
 * `back`, `forward`, `reload` — the page moves in its own session history, as the toolbar
 * buttons do. The probe only ASKS the page to go; the next document replaces this one, so its
 * answer cannot describe where the page lands. The hosts do that (a native WebView waits for the
 * incoming document and answers with it), and the first command of the new document is told the
 * page reloaded, so the model re-reads instead of trusting refs from the page it left.
 */
import type { ActuateDeps, ActuateResult } from './types'

/** The page's navigation, injectable so a test never leaves its own document. */
export interface PageNavigation {
  back(): void
  forward(): void
  reload(): void
}

/**
 * The real page. It never judges whether there is anywhere to go: the Navigation API counts only
 * same-origin entries (after site1 -> site2 it says "no earlier page" while the tab can go back),
 * and without it nothing can be known. The browser is asked, and the host that sees the next
 * document reports where the tab landed.
 */
export function pageNavigation(): PageNavigation {
  return {
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
  nav[action]()
  const note =
    action === 'reload'
      ? 'reloading the page — refs from before are invalid; take a snapshot once it has loaded'
      : `asked the tab to go ${action} in its history; if the page did not change there was nowhere to go — refs from the page left are invalid; take a snapshot to see where it is`
  return { ok: true, result: { action, note } }
}
