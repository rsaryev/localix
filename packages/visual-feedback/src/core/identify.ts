/**
 * Element identification — robust selector, readable path, cleaned classes,
 * role/accessible-name, nearby text, and a compact computed-style snapshot.
 * Vanilla DOM, shadow-DOM aware, zero deps. Re-implemented for our needs
 * (implemented locally for stable element identification).
 */

import { identifyingClasses, meaningfulClasses } from './css-classes'

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

// An <input>'s ARIA role depends on its type — a checkbox is not a textbox.
const INPUT_ROLE: Record<string, string> = {
  checkbox: 'checkbox',
  radio: 'radio',
  range: 'slider',
  search: 'searchbox',
  button: 'button',
  submit: 'button',
  reset: 'button',
  image: 'button',
  email: 'textbox',
  tel: 'textbox',
  url: 'textbox',
  text: 'textbox',
  number: 'spinbutton',
}

export function getSemanticRole(el: Element): string | undefined {
  const explicit = el.getAttribute('role')
  if (explicit) return explicit
  const tag = el.tagName.toLowerCase()
  if (tag === 'input') {
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    return INPUT_ROLE[type] ?? 'textbox' // hidden/color/date/file have no simple role → default
  }
  const implicit: Record<string, string> = {
    a: 'link',
    button: 'button',
    nav: 'navigation',
    main: 'main',
    header: 'banner',
    footer: 'contentinfo',
    aside: 'complementary',
    select: 'listbox',
    textarea: 'textbox',
  }
  return implicit[tag]
}

/** Trimmed own text + immediate sibling context, capped. */
export function getNearbyText(el: Element): string | undefined {
  const out: string[] = []
  const own = el.textContent?.trim()
  if (own && own.length < 120) out.push(own)
  const prev = el.previousElementSibling?.textContent?.trim()
  if (prev && prev.length < 50) out.unshift(`[before: "${prev.slice(0, 40)}"]`)
  const next = el.nextElementSibling?.textContent?.trim()
  if (next && next.length < 50) out.push(`[after: "${next.slice(0, 40)}"]`)
  const joined = out.join(' ').trim()
  return joined || undefined
}

/** Short human summary, e.g. `button "Sign up"`, `image "Logo"`, `section.hero`. */
export function getElementSummary(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const text = el.textContent?.trim()
  const aria = el.getAttribute('aria-label')?.slice(0, 30)
  if (tag === 'button')
    return aria ? `button [${aria}]` : text ? `button "${text.slice(0, 25)}"` : 'button'
  if (tag === 'a') return text ? `link "${text.slice(0, 25)}"` : 'link'
  if (tag === 'img') {
    const a = el.getAttribute('alt')
    return a ? `image "${a.slice(0, 30)}"` : 'image'
  }
  if (tag === 'input') {
    const ph = el.getAttribute('placeholder')?.slice(0, 30)
    const nm = el.getAttribute('name')
    return ph
      ? `input "${ph}"`
      : nm
        ? `input [${nm}]`
        : `${el.getAttribute('type') ?? 'text'} input`
  }
  if (/^h[1-6]$/.test(tag)) return text ? `${tag} "${text.slice(0, 35)}"` : tag
  if (tag === 'p' && text) return `paragraph: "${text.slice(0, 40)}${text.length > 40 ? '…' : ''}"`
  const cls = meaningfulClasses(el)[0]
  if (cls) return `${tag}.${cls}`
  if (aria) return `${tag} [${aria}]`
  return tag === 'div' ? 'container' : tag
}

const TEXT_TAGS = new Set([
  'p',
  'span',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'a',
  'li',
  'label',
  'strong',
  'em',
  'code',
])
const STYLE_DEFAULTS = new Set([
  'none',
  'normal',
  'auto',
  '0px',
  'rgba(0, 0, 0, 0)',
  'transparent',
  'static',
  'visible',
])

/** Compact computed-style snapshot, properties chosen by element kind. */
export function getComputedStyleSnapshot(el: Element): string | undefined {
  const win = el.ownerDocument?.defaultView
  if (!win) return undefined
  const cs = win.getComputedStyle(el)
  const tag = el.tagName.toLowerCase()
  const props = TEXT_TAGS.has(tag)
    ? ['color', 'font-size', 'font-weight', 'line-height', 'font-family']
    : ['background-color', 'color', 'padding', 'border-radius', 'display', 'gap']
  const parts: string[] = []
  for (const p of props) {
    const v = cs.getPropertyValue(p).trim()
    if (v && !STYLE_DEFAULTS.has(v)) parts.push(`${p}: ${v}`)
  }
  return parts.length ? parts.join('; ') : undefined
}

/** elementFromPoint that pierces open shadow roots to the deepest target. */
export function deepElementFromPoint(x: number, y: number): Element | null {
  let el = document.elementFromPoint(x, y)
  while (el?.shadowRoot) {
    const deeper = el.shadowRoot.elementFromPoint(x, y)
    if (!deeper || deeper === el) break
    el = deeper
  }
  return el
}
