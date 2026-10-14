/**
 * Synthetic input — the reliability-touched event synthesis behind the actuator's
 * click/type/press/hover/scroll. Split out of actuate/index.ts; pure DOM, no
 * protocol/dispatcher deps.
 *
 *  - synthesized pointer+mouse events at the element center (not `el.click()`), so
 *    custom controls that listen on pointer/mouse fire correctly;
 *  - React-friendly value setting (native setter) so `input` events register;
 *  - legacy keyCode/which patched onto constructed KeyboardEvents (games/canvas).
 */

import { deepElementFromPoint } from '../core/identify'
import { NAMED_KEYS } from '../keys/index'

/** Center point of `el`, clamped into the viewport so elementFromPoint is valid. */
export function centerPoint(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  return {
    x: Math.max(1, Math.min(r.left + r.width / 2, window.innerWidth - 1)),
    y: Math.max(1, Math.min(r.top + r.height / 2, window.innerHeight - 1)),
  }
}

/** The element actually on top at `el`'s center, if it isn't `el` (or kin/label). */
export function occludedBy(el: Element): Element | null {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null // not laid out — skip the check
  const { x, y } = centerPoint(el)
  const top = deepElementFromPoint(x, y)
  if (!top || top === el || el.contains(top) || top.contains(el)) return null
  if (top.tagName === 'LABEL' && (top as HTMLLabelElement).control === el) return null
  return top
}

/**
 * The element a TRUSTED mouse click would target (`event.target`): the DEEPEST node
 * under `el`'s center, as long as it is still WITHIN `el`. The snapshot stops
 * descending at an interactive control (snapshot/index.ts), so an icon button like
 * `<button><span class="icon"></button>` can only be targeted by the BUTTON — but a
 * real click's `event.target` is the inner `<span>`. A handler bound on the child, or
 * DELEGATED on `e.target.closest('.icon')` / `matches()`, fires for the user's click
 * yet NOT when we dispatch on the button (the button focuses but the
 * handler never runs). Dispatching on the deepest hit node mirrors the trusted target
 * and fixes that, while `focus()` still goes to the resolved control. Falls back to
 * `el` when there is no layout (headless / unlaid-out → `elementFromPoint` null) or the
 * hit is OUTSIDE `el` (an overlay) — we never dispatch beyond the resolved control.
 * This composes with `occludedBy`, which already returns null when the top element is a
 * descendant of `el` (exactly this case), so a click that passed occlusion dispatches
 * on that descendant here.
 */
export function hitTarget(el: Element, x: number, y: number): Element {
  const deep = deepElementFromPoint(x, y)
  return deep && el.contains(deep) ? deep : el
}

// A real user click carries gesture fields a bare `new MouseEvent(type)` omits.
// Frameworks that delegate — React 18/19 attaches ONE `click` listener on the
// createRoot container and expects the click to bubble to it as a real gesture — or
// that guard on `detail`/`buttons` never fire without them (the agent
// couldn't toggle a React theme though manual clicks worked). Enrich the inits to
// mirror a genuine primary-button click; the event ORDER and types are unchanged.
export function dispatchMouse(el: Element, type: string, x: number, y: number): void {
  const isDown = type === 'mousedown'
  // detail = click count (1 for mousedown/mouseup/click); 0 for hover-ish moves.
  const clickish = isDown || type === 'mouseup' || type === 'click'
  el.dispatchEvent(
    new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: isDown ? 1 : 0, // primary button held during mousedown; released after
      detail: clickish ? 1 : 0,
    }),
  )
}

export function dispatchPointer(el: Element, type: string, x: number, y: number): void {
  if (typeof PointerEvent !== 'function') return
  const isDown = type === 'pointerdown'
  el.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      clientX: x,
      clientY: y,
      pointerId: 1,
      isPrimary: true,
      button: 0,
      pointerType: 'mouse',
      buttons: isDown ? 1 : 0, // mirror the mouse buttons
      pressure: isDown ? 0.5 : 0, // real primary press ≈0.5; released ≈0
    }),
  )
}

export function synthClick(el: Element): void {
  const { x, y } = centerPoint(el)
  // Dispatch on the DEEPEST node under the center (mirroring a trusted click's
  // event.target), so a handler bound on / delegated by an inner child — the theme-icon
  // <span> inside an icon button — fires; focus still lands on the resolved control
  // Falls back to `el` when there is no layout or the hit is outside it.
  const target = hitTarget(el, x, y)
  dispatchPointer(target, 'pointerover', x, y)
  dispatchMouse(target, 'mouseover', x, y)
  dispatchPointer(target, 'pointerdown', x, y)
  dispatchMouse(target, 'mousedown', x, y)
  ;(el as HTMLElement).focus?.()
  dispatchPointer(target, 'pointerup', x, y)
  dispatchMouse(target, 'mouseup', x, y)
  dispatchMouse(target, 'click', x, y)
}

/** Set an input/textarea value via the native setter so React/Vue trackers fire. */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  // `PropertyDescriptor.set` is a third-party (lib.es5.d.ts) method-shorthand
  // declaration we can't edit, so call it inline via `.call` rather than storing an
  // unbound reference.
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) descriptor.set.call(el, value)
  else (el as { value: string }).value = value
}

export function fillValue(el: Element, text: string): void {
  ;(el as HTMLElement).focus?.()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    setNativeValue(el, text)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
  } else if ((el as HTMLElement).isContentEditable) {
    ;(el as HTMLElement).textContent = text
    el.dispatchEvent(new InputEvent('input', { bubbles: true }))
  } else {
    throw new Error('target is not a text field')
  }
}

/** Map a key chord like `Ctrl+Enter` → an init for KeyboardEvent. */
function keyInit(chord: string): KeyboardEventInit & { key: string } {
  const trimmed = chord.trim()
  const parts = trimmed.split('+').map((p) => p.trim())
  let key = parts.pop() ?? ''
  // A trailing '+' is the PLUS key itself ("+", "Ctrl++"), not an empty key.
  if (key === '' && trimmed.endsWith('+')) key = '+'
  const mods = new Set(parts.map((m) => m.toLowerCase()))
  const k = NAMED_KEYS[key.toLowerCase()] ?? key
  return {
    key: k,
    bubbles: true,
    cancelable: true,
    ctrlKey: mods.has('ctrl') || mods.has('control'),
    metaKey: mods.has('meta') || mods.has('cmd'),
    altKey: mods.has('alt'),
    shiftKey: mods.has('shift'),
  }
}

// Legacy keyCodes — many games/sites (e.g. play2048.co) read `event.keyCode`/`which`,
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
function keyCodeOf(key: string): number {
  if (key in KEY_CODES) return KEY_CODES[key]
  return key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0
}
function makeKeyEvent(type: string, init: KeyboardEventInit, code: number): KeyboardEvent {
  const ev = new KeyboardEvent(type, init)
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
    const style = getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden') return false
  }
  return true
}

function tabOrder(scope?: Element): HTMLElement[] {
  const candidates = [...(scope ?? document).querySelectorAll<HTMLElement>(TABBABLE)].filter(
    (el) =>
      el.tabIndex >= 0 &&
      !(el as HTMLButtonElement).disabled &&
      !(el instanceof HTMLInputElement && el.type === 'hidden') &&
      isRendered(el),
  )
  const positive = candidates
    .filter((el) => el.tabIndex > 0)
    .sort((a, b) => a.tabIndex - b.tabIndex)
  return [...positive, ...candidates.filter((el) => el.tabIndex === 0)]
}

function moveFocus(backwards: boolean, scope?: Element): void {
  const order = tabOrder(scope)
  const at = order.indexOf(document.activeElement as HTMLElement)
  const next = at < 0 ? (backwards ? order.at(-1) : order[0]) : order[at + (backwards ? -1 : 1)]
  // Past either end focus leaves the document, which reads as BODY — as with a real key.
  if (next) next.focus()
  else (document.activeElement as HTMLElement | null)?.blur?.()
}

/** `scope` keeps Tab's sequential navigation inside a host's panel (see `ActuateDeps.root`). */
export function pressKey(el: Element, chord: string, scope?: Element): void {
  const init = keyInit(chord)
  const code = keyCodeOf(init.key)
  const proceed = el.dispatchEvent(makeKeyEvent('keydown', init, code))
  if (proceed && init.key === 'Tab') moveFocus(Boolean(init.shiftKey), scope)
  el.dispatchEvent(makeKeyEvent('keyup', init, code))
  // Enter inside a form field: synthetic key events don't submit, so do it explicitly.
  if (init.key === 'Enter') {
    const form = (el as HTMLInputElement).form
    if (form) form.requestSubmit?.()
  }
}
