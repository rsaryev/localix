// Pure URL/header classification helpers for open_preview: decide whether a page
// refuses iframing (→ the "can't embed" fallback card) and whether a ref is a local file
// we should auto-serve. No IO — extracted from open-preview.ts (which owns the
// tool factory + serving/probing side effects).
import { fileURLToPath } from 'node:url'

/** Whether response headers forbid us iframing the page (X-Frame-Options / CSP frame-ancestors). */
export function isFrameBlocked(h: Headers): boolean {
  // ANY X-Frame-Options value blocks our cross-origin localhost preview: DENY and
  // SAMEORIGIN obviously, but also the deprecated `ALLOW-FROM <one-origin>` (it permits
  // exactly one parent, never ours). None of its values allow arbitrary embedding.
  const xfo = h.get('x-frame-options')
  if (xfo?.trim()) return true
  const csp = h.get('content-security-policy')
  const fa = csp?.match(/frame-ancestors([^;]*)/i)?.[1]
  // frame-ancestors present and NOT allowing us (no wildcard / no localhost) → blocked.
  if (fa != null && !/\*|localhost|127\.0\.0\.1/i.test(fa)) return true
  return false
}

/**
 * The filesystem path a local file ref names. Stripping `file://` with a regex left a URL's
 * percent-escapes in place (`my%20page.html` is not the file `my page.html`) and turned a
 * Windows `file:///C:/x.html` into `/C:/x.html`; `fileURLToPath` decodes both the way the
 * platform does. A ref it rejects (a host such as `file://./x.html`) keeps the old strip, so
 * those relative forms resolve as before and still meet the caller's containment check.
 */
export function localFileRefPath(raw: string): string {
  const s = raw.trim()
  if (!/^file:\/\//i.test(s)) return s
  try {
    return fileURLToPath(s)
  } catch {
    return s.replace(/^file:\/\//i, '')
  }
}

/** True for anything that isn't already an http(s) URL — i.e. a static file we should serve. */
export function isLocalFileRef(raw: string): boolean {
  const s = raw.trim()
  if (/^https?:\/\//i.test(s)) return false
  return (
    s.startsWith('file://') ||
    s.startsWith('/') ||
    s.startsWith('./') ||
    s.startsWith('../') ||
    /\.[a-z0-9]{1,6}$/i.test(s)
  )
}
