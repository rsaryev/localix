import { isDesktopRuntime } from '@localixai/kit/environment'
import { toast } from './notify'
import { tauriInvoke } from './tauri'

/**
 * Open a genuine EXTERNAL link (http/https/mailto/tel) in the user's default
 * browser/handler.
 *
 * On the WEB this is just `window.open(..., '_blank', 'noopener,noreferrer')`.
 * Inside the Tauri desktop shell, anchor clicks / `window.open` with
 * `target="_blank"` don't reliably reach the shell's `on_navigation` /
 * `on_new_window` guards (WKWebView in particular swallows them), so the link
 * appears dead. We therefore invoke the native `open_external` command, which
 * hands the URL to the OS via the opener plugin.
 *
 * This is ONLY for external destinations — internal `localix://` deep links,
 * in-app file references, and loopback/preview navigation must NOT be routed
 * here (they keep their existing handlers).
 *
 * EVERY caller preventDefaults the anchor before calling this (see
 * `ExternalAnchor` and the reader's link handler), which means the shell's own
 * `on_navigation` backstop never gets a chance to act. This function is
 * therefore the ONLY thing standing between a click and the OS, and it must
 * never fail quietly.
 */

/**
 * `window.open` is not a reliable success signal and must not be treated as one:
 * per spec it returns `null` whenever `noopener` is set, EVEN ON SUCCESS. A null
 * check here would report a failure on every successful web open, so the web path
 * deliberately reports nothing and trusts the browser (which shows its own
 * popup-blocked UI when it refuses).
 */
function openInNewTab(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer')
}

function reportUnopened(url: string, reason: string): void {
  toast.error('Could not open this link', {
    description: `${url}\n${reason}`,
  })
}

export function openExternal(url: string): void {
  if (!isDesktopRuntime()) {
    openInNewTab(url)
    return
  }

  const invoke = tauriInvoke()
  if (!invoke) {
    // Desktop shell, but no global bridge. These are two DIFFERENT globals:
    // `isDesktop` is true whenever `__TAURI_INTERNALS__` exists (always, in any
    // Tauri v2 webview), while `tauriInvoke()` needs `__TAURI__`, which only
    // exists when `withGlobalTauri` is on and the API bundle actually loaded.
    // Falling through to `window.open` here is what made links look dead: the
    // webview swallows it and nothing tells anyone. Try it anyway as a last
    // resort, but say what happened.
    openInNewTab(url)
    reportUnopened(
      url,
      'The desktop bridge is unavailable, so the system browser could not be reached.',
    )
    return
  }

  void invoke('open_external', { url }).catch((cause: unknown) => {
    // The native command now returns a real `Result`, so this branch is
    // reachable — it was dead code while the Rust side logged and returned Ok.
    openInNewTab(url)
    reportUnopened(url, cause instanceof Error ? cause.message : String(cause))
  })
}
