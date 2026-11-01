/**
 * Synthetic key events — chord parsing, legacy keyCode/which patching and Tab's default focus
 * move. Split out of actuate/input.ts, which re-exports `pressKey`, so importers keep one path.
 */

import { normalizeKeyName } from '../keys/index'
import { realmOf } from '../core/frames'

/** Map a key chord like `Ctrl+Enter` → an init for KeyboardEvent. */
function keyInit(chord: string): KeyboardEventInit & { key: string } {
  const trimmed = chord.trim()
  const parts = trimmed.split('+').map((p) => p.trim())
  let key = parts.pop() ?? ''
  // A trailing '+' is the PLUS key itself ("+", "Ctrl++"), not an empty key.
  if (key === '' && trimmed.endsWith('+')) key = '+'
  const mods = new Set(parts.map((m) => m.toLowerCase()))
  const k = normalizeKeyName(key)
  return {
    key: k,
    code: physicalCode(k),
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.has('ctrl') || mods.has('control'),
    metaKey: mods.has('meta') || mods.has('cmd'),
    altKey: mods.has('alt'),
    shiftKey: mods.has('shift'),
  }
}

// Legacy keyCodes — many games/sites (e.g. a browser tile game) read `event.keyCode`/`which`,
// which a constructed KeyboardEvent leaves 0. We patch them on via defineProperty.
const KEY_CODES: Record<string, number> = {
  Enter: 13,
  Tab: 9,
  Escape: 27,
  ' ': 32,
  Backspace: 8,
  Delete: 46,
  ArrowUp: 38,
  ArrowDown: 40,
  ArrowLeft: 37,
  ArrowRight: 39,
  Home: 36,
  End: 35,
  PageUp: 33,
  PageDown: 34,
}
// The physical key (`event.code`), which games read so a layout cannot move their controls:
// that tile game moves only on `code` "ArrowLeft"/"KeyA", and every key it got carried an empty one.
const PUNCTUATION_CODES: Record<string, string> = {
  ' ': 'Space',
  '-': 'Minus',
  '=': 'Equal',
  '+': 'Equal',
  ',': 'Comma',
  '.': 'Period',
  '/': 'Slash',
  ';': 'Semicolon',
  "'": 'Quote',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '`': 'Backquote',
}
function physicalCode(key: string): string {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (key in PUNCTUATION_CODES) return PUNCTUATION_CODES[key]!
  // Named keys (Enter, Escape, ArrowUp, F5…) share their name with their code.
  return key.length > 1 ? key : ''
}
function keyCodeOf(key: string): number {
  if (key in KEY_CODES) return KEY_CODES[key]
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
}
function makeKeyEvent(
  el: Element,
  type: string,
  init: KeyboardEventInit,
  code: number,
): KeyboardEvent {
  // The target's own realm: a frame's handlers check `instanceof` against its constructors.
  const ev = new (realmOf(el).KeyboardEvent)(type, init)
  // keyCode/which are read-only on the prototype; override so legacy handlers see them.
  try {
    Object.defineProperty(ev, 'keyCode', { get: () => code })
    Object.defineProperty(ev, 'which', { get: () => code })
  } catch {
    /* some engines forbid this — key-based handlers still work */
  }
  return ev
}

// Tab's default action, which an untrusted event never gets. Without it focus stays put,
// and a focus-trap check reads `document.activeElement` as BODY: a false failure the agent
// cannot tell from a real one. A page that handles Tab itself (a trap) prevents the default,
// so this only runs where the browser's own sequential navigation would.
const TABBABLE =
  'a[href],area[href],button,input,select,textarea,iframe,summary,[contenteditable=""],[contenteditable="true"],[tabindex]'

function isRendered(el: HTMLElement): boolean {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    if (node.hidden || node.inert) return false
    const style = realmOf(node).getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function tabOrder(doc: Document, scope?: Element): HTMLElement[] {
  const candidates = [...(scope ?? doc).querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !(el instanceof realmOf(el).HTMLInputElement && el.type === 'hidden') &&
      isRendered(el),
  )
  const positive = candidates
    .filter((el) => el.tabIndex > 0)
    .sort((a, b) => a.tabIndex - b.tabIndex)
  return [...positive, ...candidates.filter((el) => el.tabIndex === 0)]
}

/** In the document of the element that took the key: a frame has its own focus and tab order. */
function moveFocus(doc: Document, backwards: boolean, scope?: Element): void {
  const order = tabOrder(doc, scope)
  const at = order.indexOf(doc.activeElement as HTMLElement)
  const next = at < 0 ? (backwards ? order.at(-1) : order[0]) : order[at + (backwards ? -1 : 1)]
  // Past either end focus leaves the document, which reads as BODY — as with a real key.
  if (next) next.focus()
  else (doc.activeElement as HTMLElement | null)?.blur?.()
}

/** `scope` keeps Tab's sequential navigation inside a host's panel (see `ActuateDeps.root`). */
export function pressKey(el: Element, chord: string, scope?: Element): void {
  const init = keyInit(chord)
  const code = keyCodeOf(init.key)
  const proceed = el.dispatchEvent(makeKeyEvent(el, 'keydown', init, code))
  if (proceed && init.key === 'Tab') moveFocus(el.ownerDocument, Boolean(init.shiftKey), scope)
  el.dispatchEvent(makeKeyEvent(el, 'keyup', init, code))
  // Enter inside a form field: synthetic key events don't submit, so do it explicitly.
  if (init.key === 'Enter') {
    const form = (el as HTMLInputElement).form
    if (form) form.requestSubmit?.()
  }
}
