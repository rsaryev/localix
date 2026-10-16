/**
 * Subresource-failure capture — the probe's window into a page whose CSS/JS/images
 * failed to LOAD (a 404'd `<link href="assets/style.css">`, a broken `<script>`).
 *
 * Motivation: probe clicks flipped `body[data-theme]` correctly, but
 * the page looked unstyled and never changed color — the stylesheet had 404'd during
 * a mid-session file reorg, so the theme vars had no CSS to apply. Neither the model
 * nor the user learned WHY; they blamed the button. Surfacing failed resources turns
 * that silent page-side breakage into an explicit signal.
 *
 * Two signals, unioned (each covers the other's blind spot):
 *  1. A capture-phase `error` listener on window — resource load errors fire on the
 *     element and DON'T bubble, so capture phase is required. Catches anything that
 *     fails AFTER the probe mounts (any tag), but misses a failure that already fired
 *     before the listener was installed.
 *  2. A read-time scan of `<link rel="stylesheet">` for `.sheet === null` once the
 *     document has finished loading — catches a stylesheet that 404'd BEFORE the
 *     probe mounted (the common case for an inlined-probe served file). Gated on
 *     `readyState === 'complete'` so a still-loading sheet isn't a false positive.
 *
 * Closure-free, no actuation deps — mirrors console-capture.ts.
 */

export interface ResourceErrorCapture {
  /** Deduped, capped, formatted failures, e.g. `stylesheet assets/style.css`. */
  read(): string[]
  uninstall(): void
}

const MAX_ITEMS = 12

/** Strip the origin so `http://localhost:5173/assets/style.css` → `assets/style.css`. */
function shortUrl(raw: string): string {
  if (!raw) return raw
  try {
    const u = new URL(raw, location.href)
    if (u.origin === location.origin) return u.pathname.replace(/^\//, '') + u.search
    return u.href
  } catch {
    return raw
  }
}

/** A concise kind label for a failed resource element. */
function labelFor(el: Element): string | null {
  const tag = el.tagName.toLowerCase()
  if (tag === 'link') {
    const rel = (el.getAttribute('rel') ?? '').toLowerCase()
    const href = el.getAttribute('href')
    if (!href) return null
    const kind = rel.includes('stylesheet') ? 'stylesheet' : rel.includes('icon') ? 'icon' : 'link'
    return `${kind} ${shortUrl(href)}`
  }
  const src = el.getAttribute('src')
  if (!src) return null
  const kind =
    tag === 'script' ? 'script' : tag === 'img' ? 'image' : tag === 'source' ? 'media' : tag
  return `${kind} ${shortUrl(src)}`
}

/**
 * Scan `<link rel="stylesheet">` for a null `.sheet` — a stylesheet that failed (or
 * was blocked) leaves no sheet once loading is done. Pure over a document-like so it
 * is unit-testable; the caller gates it on `readyState === 'complete'` to avoid
 * flagging a sheet that is merely still loading.
 */
export function scanFailedStylesheets(doc: Document): string[] {
  const out: string[] = []
  for (const link of Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'))) {
    const l = link as HTMLLinkElement
    const href = l.getAttribute('href')
    if (href && l.sheet == null) out.push(`stylesheet ${shortUrl(href)}`)
  }
  return out
}

export function installResourceErrorCapture(): ResourceErrorCapture {
  const seen = new Set<string>()
  const items: string[] = []
  const add = (label: string | null) => {
    if (!label || seen.has(label)) return
    seen.add(label)
    if (items.length < MAX_ITEMS) items.push(label)
  }

  const onError = (e: Event) => {
    const t = e.target as Element | null
    // A JS runtime ErrorEvent targets window (not an Element) — that's console-capture's
    // job; here we only want element resource-load failures.
    if (!t || t === (window as unknown as EventTarget) || !(t instanceof Element)) return
    add(labelFor(t))
  }
  // Capture phase: resource `error` events do not bubble.
  window.addEventListener('error', onError, true)

  return {
    read() {
      const out = [...items]
      // Secondary signal: a stylesheet that failed BEFORE the listener existed leaves
      // its <link> with a null `.sheet` once loading is done. Only trust this when the
      // document has finished (a slow sheet is still null mid-load → false positive).
      // Through `globalThis`: a BARE `document` outside a DOM is undeclared, not undefined,
      // so reading it throws a ReferenceError that optional chaining cannot catch.
      if (globalThis.document?.readyState === 'complete') {
        for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"]'))) {
          const l = link as HTMLLinkElement
          const href = l.getAttribute('href')
          if (!href) continue
          if (l.sheet == null) {
            const label = `stylesheet ${shortUrl(href)}`
            if (!seen.has(label) && out.length < MAX_ITEMS) {
              seen.add(label)
              out.push(label)
            }
          }
        }
      }
      return out
    },
    uninstall() {
      window.removeEventListener('error', onError, true)
    },
  }
}
