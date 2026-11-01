/**
 * Element identification — robust selector, readable path, cleaned classes,
 * role/accessible-name, nearby text, and a compact computed-style snapshot.
 * Vanilla DOM, shadow-DOM aware, zero deps. Re-implemented for our needs
 * (implemented locally for stable element identification).
 */

import { identifyingClasses, meaningfulClasses } from './css-classes'
import { frameDocument, frameOrigin, isFrame } from './frames'

// Role, summary, text and style description live in a sibling; re-exported so importers keep this path.
export {
  getSemanticRole,
  getNearbyText,
  getElementSummary,
  getComputedStyleSnapshot,
} from './describe'

/** Parent that crosses an open shadow boundary (host when at a shadow root). */
function parentCrossingShadow(el: Element): Element | null {
  if (el.parentElement) return el.parentElement
  const root = el.getRootNode()
  if (root instanceof ShadowRoot) return root.host
  return null
}

/** First stable identifying attribute selector (id/test-id/name/aria), if any. */
function attributeSelector(el: Element): string | null {
  for (const attr of ['data-testid', 'data-test', 'data-test-id', 'name']) {
    const v = el.getAttribute(attr)
    if (v) return `[${attr}="${esc(v)}"]`
  }
  const aria = el.getAttribute('aria-label')
  if (aria) return `${el.tagName.toLowerCase()}[aria-label="${esc(aria)}"]`
  return null
}

/** CSS.escape with a defensive fallback (older engines). */
function esc(v: string): string {
  const C = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS
  if (C?.escape) return C.escape(v)
  return v.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

function uniqueIn(root: Document | ShadowRoot, selector: string): boolean {
  try {
    return root.querySelectorAll(selector).length === 1
  } catch {
    return false
  }
}

function nthOfType(el: Element): number {
  const tag = el.tagName
  let i = 1
  let sib = el.previousElementSibling
  while (sib) {
    if (sib.tagName === tag) i++
    sib = sib.previousElementSibling
  }
  return i
}

export interface SelectorResult {
  selector: string
  confidence: 'high' | 'medium' | 'low'
}

/**
 * Build a robust selector: `#id` (if unique) > unique meaningful `.class` >
 * an `nth-of-type` chain capped at `maxDepth`. Scoped to the element's own
 * root (document or shadow root) for uniqueness checks.
 */
export function generateSelector(el: Element, maxDepth = 5): SelectorResult {
  const root = el.getRootNode()
  const scope: Document | ShadowRoot =
    root instanceof ShadowRoot ? root : root instanceof Document ? root : document

  if (el.id) {
    const byId = `#${esc(el.id)}`
    if (uniqueIn(scope, byId)) return { selector: byId, confidence: 'high' }
  }

  const tag = el.tagName.toLowerCase()
  // The page root addresses itself. The climb below stops AT `html`/`body`, because no chain
  // needs them as a prefix — but when the root IS the pick, that left the capture with an
  // empty selector, which every consumer reads as "nothing to point at". A comment on the
  // whole screen therefore arrived with no screenshot: the host never asked for one.
  if (tag === 'html' || tag === 'body') return { selector: tag, confidence: 'high' }
  // Prefer a unique IDENTIFYING class (skip Tailwind/atomic utilities — they aren't
  // unique and don't help locate code).
  for (const cls of identifyingClasses(el)) {
    const byClass = `${tag}.${esc(cls)}`
    if (uniqueIn(scope, byClass)) return { selector: byClass, confidence: 'high' }
  }
  // Then a stable attribute (test-id / name / aria-label).
  const attr = attributeSelector(el)
  if (attr && uniqueIn(scope, attr)) return { selector: attr, confidence: 'high' }

  // nth-of-type chain upward (each level uses an identifying class if it has one).
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && depth < maxDepth) {
    const t = cur.tagName.toLowerCase()
    if (t === 'html' || t === 'body') break
    if (cur.id) {
      parts.unshift(`#${esc(cur.id)}`)
      break // id is a strong anchor — stop climbing
    }
    const cls = identifyingClasses(cur)[0]
    const part = `${cls ? `${t}.${esc(cls)}` : t}:nth-of-type(${nthOfType(cur)})`
    parts.unshift(part)
    cur = parentCrossingShadow(cur)
    depth++
  }
  const selector = parts.join(' > ')
  return { selector, confidence: parts.length <= 2 ? 'medium' : 'low' }
}

/**
 * The element's opening tag with only identifying attributes — a literal,
 * grep-able snippet (e.g. `<button class="lucide-filter" aria-label="Filter">`).
 * Utility classes are dropped; specific ones (icon names, component classes) kept.
 */
export function getOpenTagHtml(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const attrs: string[] = []
  if (el.id) attrs.push(`id="${el.id}"`)
  for (const a of [
    'data-testid',
    'name',
    'type',
    'role',
    'aria-label',
    'href',
    'placeholder',
    'alt',
  ]) {
    const v = el.getAttribute(a)
    if (v) attrs.push(`${a}="${v.length > 40 ? `${v.slice(0, 40)}…` : v}"`)
  }
  // `src` identifies images/icons/media — keep the tail (filename), not the host prefix.
  const src = el.getAttribute('src')
  if (src) attrs.push(`src="${src.length > 48 ? `…${src.slice(-48)}` : src}"`)
  const ident = identifyingClasses(el).slice(0, 3)
  if (ident.length) attrs.push(`class="${ident.join(' ')}"`)
  const head = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
  return head.length > 200 ? `${head.slice(0, 197)}…` : head
}

/** Readable path, e.g. `header.nav > a`. Marks shadow crossings. */
export function getReadablePath(el: Element, maxDepth = 4): string {
  const parts: string[] = []
  let cur: Element | null = el
  let depth = 0
  while (cur && depth < maxDepth) {
    const t = cur.tagName.toLowerCase()
    if (t === 'html' || t === 'body') break
    let id = t
    if (cur.id) id = `${t}#${cur.id}`
    else {
      const cls = meaningfulClasses(cur)[0]
      if (cls) id = `${t}.${cls}`
    }
    const crossing = !cur.parentElement && parentCrossingShadow(cur)
    if (crossing) id = `«shadow» ${id}`
    parts.unshift(id)
    cur = parentCrossingShadow(cur)
    depth++
  }
  return parts.join(' > ')
}

/**
 * elementFromPoint that pierces open shadow roots and same-origin frames to the deepest target.
 * `doc` is the document the point is in; entering a frame moves the point into its coordinates.
 */
export function deepElementFromPoint(
  x: number,
  y: number,
  doc: Document = document,
): Element | null {
  let el = doc.elementFromPoint(x, y)
  while (el?.shadowRoot) {
    const deeper = el.shadowRoot.elementFromPoint(x, y)
    if (!deeper || deeper === el) break
    el = deeper
  }
  const inner = el && isFrame(el) ? frameDocument(el) : null
  if (el && inner) {
    const o = frameOrigin(el)
    const hit = deepElementFromPoint(x - o.x, y - o.y, inner)
    // Bare frame content is the frame itself to a person: that is what covers the page there.
    return hit && hit !== inner.documentElement && hit !== inner.body ? hit : el
  }
  return el
}
