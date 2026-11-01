/**
 * Element description — role/accessible-name, nearby text, short summary and a compact
 * computed-style snapshot. Split out of core/identify.ts, which re-exports it, so importers keep
 * one path. Vanilla DOM, zero deps.
 */

import { meaningfulClasses } from './css-classes'

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
