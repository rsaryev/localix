/**
 * Snapshot element CLASSIFICATION — the pure, stateless DOM heuristics the
 * snapshot walker uses to decide whether a node is interactive, hidden, or
 * content-bearing, and how to label/name it. No registry, no recursion, no
 * output assembly — that orchestration lives in `./index`.
 *
 * Vanilla DOM, shadow-aware, zero deps; reuses the role heuristics from
 * `core/identify`.
 */

import { getSemanticRole } from '../core/identify'

const NATIVE_INTERACTIVE = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
  'option',
])
const INTERACTIVE_ROLES = new Set([
  'button',
  'link',
  'textbox',
  'checkbox',
  'radio',
  'slider',
  'searchbox',
  'spinbutton',
  'listbox',
  'combobox',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'switch',
  'option',
])
const LANDMARK_ROLES = new Set([
  'navigation',
  'main',
  'banner',
  'contentinfo',
  'complementary',
  'search',
  'region',
  'form',
])
/** Tags we never descend into / emit. */
export const SKIP_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'head',
  'meta',
  'link',
  'title',
  'br',
  'hr',
])

export function viewOf(el: Element): Window | null {
  return el.ownerDocument?.defaultView ?? null
}

export function isHidden(el: Element, cs: CSSStyleDeclaration | null): boolean {
  if (el.hasAttribute('hidden') || el.getAttribute('aria-hidden') === 'true') return true
  if (!cs) return false
  return cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse'
}

export function isInteractive(el: Element, cs: CSSStyleDeclaration | null): boolean {
  const tag = el.tagName.toLowerCase()
  if (NATIVE_INTERACTIVE.has(tag)) {
    if (tag === 'input' && (el as HTMLInputElement).type === 'hidden') return false
    if (tag === 'a' && !el.getAttribute('href')) {
      // a bare <a> with no href is interactive only if it carries a handler/role/tabindex
      return (
        el.hasAttribute('onclick') ||
        !!el.getAttribute('role') ||
        el.getAttribute('tabindex') != null
      )
    }
    return true
  }
  const role = el.getAttribute('role')
  if (role && INTERACTIVE_ROLES.has(role)) return true
  if (el.hasAttribute('onclick')) return true
  const ti = el.getAttribute('tabindex')
  if (ti != null && Number(ti) >= 0) return true
  // Custom controls: a non-native element with a pointer cursor (e.g. `<div onClick>`).
  if (cs?.cursor === 'pointer' && (tag === 'div' || tag === 'span' || tag === 'li')) return true
  return false
}

/** Direct (own) text only — so a wrapper's name isn't its whole subtree. */
function directText(el: Element): string {
  let s = ''
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) s += n.textContent ?? ''
  })
  return collapse(s)
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function clip(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** Accessible-ish name for the tree label. */
function accessibleName(el: Element): string {
  const aria = el.getAttribute('aria-label')
  if (aria) return clip(collapse(aria))
  const tag = el.tagName.toLowerCase()
  if (tag === 'img') return clip(collapse(el.getAttribute('alt') ?? ''))
  if (tag === 'input') {
    const inp = el as HTMLInputElement
    // Prefer the CURRENT value so the agent can verify what it typed; fall back to the
    // placeholder/name for an empty field. Never surface a password's value.
    const type = (el.getAttribute('type') ?? 'text').toLowerCase()
    const value = type === 'password' ? '' : (inp.value ?? '').trim()
    return clip(collapse(value || el.getAttribute('placeholder') || el.getAttribute('name') || ''))
  }
  if (tag === 'textarea') {
    const ta = el as HTMLTextAreaElement
    return clip(
      collapse(
        (ta.value ?? '').trim() || el.getAttribute('placeholder') || el.getAttribute('name') || '',
      ),
    )
  }
  // Controls/headings get their full text; everything else only its own text node.
  const leafish =
    NATIVE_INTERACTIVE.has(tag) ||
    /^h[1-6]$/.test(tag) ||
    tag === 'label' ||
    tag === 'p' ||
    tag === 'li'
  const text = leafish ? collapse(el.textContent ?? '') : directText(el)
  return clip(text)
}

/** Tree role label, falling back to the tag for plain content. */
export function roleLabel(el: Element): string {
  const role = getSemanticRole(el)
  if (role) return role
  const tag = el.tagName.toLowerCase()
  if (/^h[1-6]$/.test(tag)) return `heading ${tag[1]}`
  if (tag === 'img') return 'image'
  if (tag === 'li') return 'listitem'
  if (tag === 'label') return 'label'
  if (tag === 'td' || tag === 'th') return 'cell'
  // p / div / span / etc. are emitted only for their text → label them uniformly.
  return 'text'
}

/** Compact state suffix, e.g. ` [checked]` / ` [disabled]`. */
export function stateSuffix(el: Element): string {
  const bits: string[] = []
  const inp = el as HTMLInputElement
  if ((el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true')
    bits.push('disabled')
  const type = (el.getAttribute('type') ?? '').toLowerCase()
  if (
    type === 'checkbox' ||
    type === 'radio' ||
    el.getAttribute('role') === 'checkbox' ||
    el.getAttribute('role') === 'radio'
  ) {
    const checked = inp.checked ?? el.getAttribute('aria-checked') === 'true'
    bits.push(checked ? 'checked' : 'unchecked')
  }
  return bits.length ? ` [${bits.join(', ')}]` : ''
}

/**
 * Decide if a node is worth a line of its own. Interactive controls, headings,
 * landmarks, images-with-alt, and small text leaves are emitted; pure layout
 * wrappers are not (children fold up to the parent's depth → compact tree).
 */
export function shouldEmit(el: Element, interactive: boolean): { emit: boolean; name: string } {
  const tag = el.tagName.toLowerCase()
  const name = accessibleName(el)
  if (interactive) return { emit: true, name }
  if (tag === 'img') return { emit: true, name }
  if (LANDMARK_ROLES.has(getSemanticRole(el) ?? '')) return { emit: true, name }
  // ANY element carrying its OWN text is a content node — a heading, a table cell,
  // a list item, OR a game tile / score / data value in a div/span. `accessibleName`
  // returns only the element's own text (not its subtree) for non-leaf tags, so a
  // pure layout wrapper has an empty name and is skipped, but a `<div>128</div>` tile
  // emits. This is what lets the agent READ app state from text instead of falling
  // back to a screenshot.
  if (name) return { emit: true, name }
  return { emit: false, name }
}
