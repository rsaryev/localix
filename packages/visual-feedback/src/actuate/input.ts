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
import { frameOrigin, ownerFrame, realmOf } from '../core/frames'

/**
 * Center point of `el`, clamped into ITS viewport so elementFromPoint is valid. In a frame the
 * point is in the frame's own coordinates, which is what its events carry.
 */
export function centerPoint(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect()
  const view = realmOf(el)
  return {
    x: Math.max(1, Math.min(r.left + r.width / 2, view.innerWidth - 1)),
    y: Math.max(1, Math.min(r.top + r.height / 2, view.innerHeight - 1)),
  }
}

/** The element actually on top at `el`'s center, if it isn't `el` (or kin/label). */
export function occludedBy(el: Element): Element | null {
  const r = el.getBoundingClientRect()
  if (r.width === 0 && r.height === 0) return null // not laid out — skip the check
  const { x, y } = centerPoint(el)
  const top = deepElementFromPoint(x, y, el.ownerDocument)
  if (top && top !== el && !el.contains(top) && !top.contains(el)) {
    if (!(top.tagName === 'LABEL' && (top as HTMLLabelElement).control === el)) return top
  }
  return coveringFrame(el, x, y)
}

/**
 * In a frame, the page may cover the frame at the point: walk out frame by frame, translating the
 * point, and name what is on top there unless it is the frame itself (or holds it).
 */
function coveringFrame(el: Element, x: number, y: number): Element | null {
  let px = x
  let py = y
  for (let frame = ownerFrame(el); frame; frame = ownerFrame(frame)) {
    const o = frameOrigin(frame)
    px += o.x
    py += o.y
    const parentDoc = frame.ownerDocument
    const top = parentDoc.elementFromPoint(px, py)
    if (top && top !== frame && !top.contains(frame) && !top.shadowRoot?.contains(frame)) return top
  }
  return null
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
  const deep = deepElementFromPoint(x, y, el.ownerDocument)
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
  const realm = realmOf(el)
  el.dispatchEvent(
    new realm.MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: realm as unknown as Window,
      clientX: x,
      clientY: y,
      button: 0,
      buttons: isDown ? 1 : 0, // primary button held during mousedown; released after
      detail: clickish ? 1 : 0,
    }),
  )
}

export function dispatchPointer(el: Element, type: string, x: number, y: number): void {
  const realm = realmOf(el)
  if (typeof realm.PointerEvent !== 'function') return
  const isDown = type === 'pointerdown'
  el.dispatchEvent(
    new realm.PointerEvent(type, {
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
  const realm = realmOf(el)
  const proto =
    el instanceof realm.HTMLTextAreaElement
      ? realm.HTMLTextAreaElement.prototype
      : realm.HTMLInputElement.prototype
  // `PropertyDescriptor.set` is a third-party (lib.es5.d.ts) method-shorthand
  // declaration we can't edit, so call it inline via `.call` rather than storing an
  // unbound reference.
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  if (descriptor?.set) descriptor.set.call(el, value)
  else (el as { value: string }).value = value
}

export function fillValue(el: Element, text: string): void {
  ;(el as HTMLElement).focus?.()
  const realm = realmOf(el)
  if (el instanceof realm.HTMLInputElement || el instanceof realm.HTMLTextAreaElement) {
    setNativeValue(el, text)
    el.dispatchEvent(new realm.Event('input', { bubbles: true }))
    el.dispatchEvent(new realm.Event('change', { bubbles: true }))
  } else if ((el as HTMLElement).isContentEditable) {
    ;(el as HTMLElement).textContent = text
    el.dispatchEvent(new realm.InputEvent('input', { bubbles: true }))
  } else {
    throw new Error('target is not a text field')
  }
}

// Key-event synthesis lives in a sibling; re-exported so importers keep this path.
export { pressKey } from './keys'
