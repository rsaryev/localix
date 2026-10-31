/**
 * Frames a person sees as part of the page. A consent banner, an embedded form or an editor a
 * script wrote into a same-origin iframe is reachable through `contentDocument`: the snapshot
 * offers its controls, and an action translates its point into the page's coordinates. A frame
 * of another origin cannot be entered; it is named so it is not mistaken for an empty page.
 * Small frames (ad slots) and frames far off screen are left out.
 */

/** A frame smaller than this share of the viewport is not part of the page (an ad slot). */
const FRAME_MIN_AREA = 0.03
/** A fixed frame on top of the page covering this share of the viewport is a modal. */
const OVERLAY_MIN_AREA = 0.1

export const FRAME_SELECTOR = 'iframe,frame'

export function isFrame(el: Element): boolean {
  const tag = el.tagName.toLowerCase()
  return tag === 'iframe' || tag === 'frame'
}

/** The frame's document, or null for another origin, a sandbox or a frame still loading. */
export function frameDocument(frame: Element): Document | null {
  try {
    const doc = (frame as HTMLIFrameElement).contentDocument
    return doc?.body ? doc : null
  } catch {
    return null
  }
}

/** Whether the frame is big enough and in view (or just below it) to count as page content. */
export function frameIsShown(frame: Element): boolean {
  const view = frame.ownerDocument.defaultView
  if (!view) return false
  const r = frame.getBoundingClientRect()
  const near =
    r.bottom > 0 && r.right > 0 && r.top < view.innerHeight * 1.5 && r.left < view.innerWidth
  return near && r.width * r.height >= FRAME_MIN_AREA * view.innerWidth * view.innerHeight
}

/** The frame element holding `el`'s document, or null for the top document. */
export function ownerFrame(el: Element): Element | null {
  const view = el.ownerDocument?.defaultView
  // The actuator's own window is the page it drives, even where an embedder holds it in a frame.
  if (!view || view === window) return null
  try {
    if (view.frameElement) return view.frameElement
    const parent = view.parent
    if (!parent || parent === view) return null
    for (const f of Array.from(parent.document.querySelectorAll(FRAME_SELECTOR)))
      if (frameDocument(f) === el.ownerDocument) return f
  } catch {
    /* a parent of another origin: not a frame we can see */
  }
  return null
}

/** The frame's content origin in its parent's viewport coordinates. */
export function frameOrigin(frame: Element): { x: number; y: number } {
  const r = frame.getBoundingClientRect()
  return { x: r.left + frame.clientLeft, y: r.top + frame.clientTop }
}

/** A fixed frame on top of the page that covers a tenth of it: a modal, like a `[role=dialog]`. */
export function isOverlayFrame(frame: Element): boolean {
  const doc = frame.ownerDocument
  const view = doc.defaultView
  if (!view) return false
  const r = frame.getBoundingClientRect()
  const left = Math.max(0, r.left)
  const right = Math.min(view.innerWidth, r.right)
  const top = Math.max(0, r.top)
  const bottom = Math.min(view.innerHeight, r.bottom)
  if (right <= left || bottom <= top) return false
  if ((right - left) * (bottom - top) < OVERLAY_MIN_AREA * view.innerWidth * view.innerHeight)
    return false
  if (doc.elementFromPoint((left + right) / 2, (top + bottom) / 2) !== frame) return false
  for (let n: Element | null = frame; n; n = n.parentElement)
    if (view.getComputedStyle(n).position === 'fixed') return true
  return false
}

/** Whether `el` lives in a frame that is a modal over its page (at any depth). */
export function inOverlayFrame(el: Element): boolean {
  for (let f = ownerFrame(el); f; f = ownerFrame(f)) if (isOverlayFrame(f)) return true
  return false
}

/** `el`'s own window (a frame is another realm: its constructors are not the top page's). */
export function realmOf(el: Element): typeof globalThis {
  return (el.ownerDocument?.defaultView ?? window) as unknown as typeof globalThis
}
