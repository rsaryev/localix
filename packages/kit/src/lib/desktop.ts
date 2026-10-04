// Desktop (Tauri) integration helpers.
//
// The Tauri shell injects an initialization script in PROD that sets these
// globals before any page script runs (embedded-API port handoff). In DEV
// (`tauri dev`) that script is not injected — the API is the developer's own
// `bun run dev` on :5051 — but Tauri's own `__TAURI_INTERNALS__` global is
// always present in the webview, so desktop detection never depends on the URL
// scheme or the injected port.

declare global {
  interface Window {
    /** Stamped by an inline script at the very top of index.html (startup attribution). */
    __LOCALIX_DOC_START?: number
    __LOCALIX_DESKTOP?: boolean
    __LOCALIX_API_PORT?: number
    __LOCALIX_OAUTH_PORT?: number
    __LOCALIX_RUNTIME_STATUS?: 'starting' | 'ready' | 'error'
    __LOCALIX_RUNTIME_ERROR?: string | null
    /** Present in any Tauri v2 webview (dev + prod), even without our injection. */
    __TAURI_INTERNALS__?: unknown
  }

  /**
   * Commit this bundle was built from, replaced at build time by Vite's `define`
   * (`'dev'` when served).
   *
   * The packaged app embeds its frontend INSIDE the Rust binary, so a rebuilt UI
   * only reaches the app through a full `tauri build`. Reading a launch log without
   * knowing which build produced it has twice led to chasing a defect that the
   * source had already fixed — this makes the answer part of the measurement.
   */
  const __UI_BUILD__: string
}

/**
 * True when running inside the Tauri desktop shell (dev or packaged).
 *
 * Evaluated on demand rather than captured at import. The shell's globals exist
 * before any page script in the real app, so the two agree there — but a module
 * graph that happens to load this file earlier (a test harness, a future
 * pre-bootstrap import) would otherwise freeze `false` for the process lifetime
 * and silently route desktop-only work down the web path.
 */
export function isDesktopRuntime(): boolean {
  return (
    typeof window !== 'undefined' &&
    (window.__LOCALIX_DESKTOP === true || typeof window.__TAURI_INTERNALS__ !== 'undefined')
  )
}

/** Import-time snapshot, kept for the many call sites that read it as a value. */
export const isDesktop: boolean = isDesktopRuntime()

/** The embedded API port chosen by the desktop shell, if any. */
export function getDesktopApiPort(): number | undefined {
  if (typeof window === 'undefined') return undefined
  if (typeof window.__LOCALIX_API_PORT === 'number') return window.__LOCALIX_API_PORT
  // Legacy fallback: port passed as a query parameter. Guard against a
  // non-numeric value so a malformed URL can't yield a NaN port downstream.
  const fromQuery = new URLSearchParams(window.location.search).get('__api_port')
  const parsed = fromQuery ? Number(fromQuery) : Number.NaN
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Stable port that serves the OAuth callback in desktop mode. Kept constant
 * across launches (unlike the random API port) so OpenRouter can register the
 * callback URL once. Falls back to the API port if not injected.
 */
export function getDesktopOAuthPort(): number | undefined {
  if (typeof window === 'undefined') return undefined
  if (typeof window.__LOCALIX_OAUTH_PORT === 'number') return window.__LOCALIX_OAUTH_PORT
  return getDesktopApiPort()
}
