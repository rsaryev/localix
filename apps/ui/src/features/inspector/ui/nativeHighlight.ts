/** A rectangle in the page's viewport, as the actuator reports an element's place. */
export interface ViewportRect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * The action after which the person is shown what was targeted. Clicks and typing reach the page
 * only as steps of a batch (from the agent or from a goal run), whose result carries the rect of
 * the last one.
 */
const SHOWN = new Set(['steps'])

/** How long the box stays; short, so it never outlives the next command's look at the page. */
const HIGHLIGHT_MS = 700

/** The rect to show for a finished action, or null when there is nothing worth drawing. */
export function highlightRect(
  action: string,
  result: Record<string, unknown> | undefined,
): ViewportRect | null {
  if (!SHOWN.has(action)) return null
  const rect = result?.rect as Partial<ViewportRect> | null | undefined
  if (!rect) return null
  const { x, y, width, height } = rect
  const numbers = [x, y, width, height]
  if (!numbers.every((n) => typeof n === 'number' && Number.isFinite(n))) return null
  if ((width as number) < 1 || (height as number) < 1) return null
  return { x: x!, y: y!, width: width!, height: height! }
}

/**
 * The script that draws the box in the page. It is passive: one fixed, inert, aria-hidden element
 * that takes no pointer events, replaces its predecessor and removes itself; a page that forbids it
 * (a strict document) simply goes without. Reduced motion gets the box without the fade.
 */
export function highlightScript(rect: ViewportRect): string {
  return `(() => { try {
  const old = document.querySelector('[data-localix-agent-highlight]'); if (old) old.remove()
  const box = document.createElement('div')
  box.setAttribute('data-localix-agent-highlight', '')
  box.setAttribute('aria-hidden', 'true')
  const r = ${JSON.stringify(rect)}
  Object.assign(box.style, { position: 'fixed', left: r.x + 'px', top: r.y + 'px',
    width: r.width + 'px', height: r.height + 'px', boxSizing: 'border-box', pointerEvents: 'none',
    zIndex: '2147483647', border: '2px solid rgba(59,130,246,0.95)', borderRadius: '4px',
    background: 'rgba(59,130,246,0.14)', boxShadow: '0 0 0 3px rgba(59,130,246,0.25)' })
  ;(document.body || document.documentElement).appendChild(box)
  const still = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!still && box.animate) box.animate([{ opacity: 1 }, { opacity: 1, offset: 0.6 }, { opacity: 0 }], { duration: ${HIGHLIGHT_MS}, easing: 'ease-out', fill: 'forwards' })
  setTimeout(() => box.remove(), ${HIGHLIGHT_MS})
} catch (e) {} })()`
}
