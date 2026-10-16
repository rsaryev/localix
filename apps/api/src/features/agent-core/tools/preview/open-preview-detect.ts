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
  const fa = csp
    ?.split(';')
    .map((directive) => directive.trim().split(/\s+/))
    .find(([name]) => name?.toLowerCase() === 'frame-ancestors')
  // frame-ancestors present and NOT allowing our localhost parent → blocked.
  return fa != null && !fa.slice(1).some(sourceAllowsLocalhost)
}

/** Hosts our preview parent can be served from. */
const LOCAL_PARENT_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether one CSP source expression admits a localhost parent. Judged per source, by its
 * host: a substring test let `https://localhost.evil.com` or `*.localhost.example` pass.
 */
function sourceAllowsLocalhost(source: string): boolean {
  const s = source.toLowerCase()
  if (s === '*' || s === 'http:' || s === 'https:') return true
  const host = s
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split('/')[0]!
    .replace(/:(?:\d+|\*)$/, '')
  return LOCAL_PARENT_HOSTS.has(host)
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
