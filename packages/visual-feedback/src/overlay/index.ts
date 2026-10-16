/**
 * In-page overlay — draws the hover outline, the active-selection box, the drag
 * marquee, and persistent numbered markers for saved comments. Rendered with
 * vanilla DOM in a `position:fixed` root so it tracks scroll natively. Every node
 * carries `data-vf-ignore` so hit-testing and the host both skip it.
 *
 * Colors are driven by CSS variables forwarded from the host theme (so the
 * overlay matches the app), with sensible fallbacks.
 */

import { VF_IGNORE_ATTR } from '../protocol/index'
import { getViewportRect } from '../core/geometry'
import { getElementSummary } from '../core/identify'

const Z = 2147483000 // just under max — above app content, the probe owns the top

function div(parent: Element, style: Partial<CSSStyleDeclaration>): HTMLDivElement {
  const d = document.createElement('div')
  d.setAttribute(VF_IGNORE_ATTR, '')
  Object.assign(d.style, style)
  parent.appendChild(d)
  return d
}

export interface Overlay {
  setHover(el: Element | null): void
  setActive(el: Element | null): void
  setMarquee(rect: { x: number; y: number; width: number; height: number } | null): void
  /** Quiet highlight over every element that already carries a comment. */
  setMarks(selectors: string[]): void
  /** Recompute positions of active box + marks (call on scroll/resize). */
  refresh(): void
  destroy(): void
}

export function createOverlay(): Overlay {
  const root = document.createElement('div')
  root.setAttribute(VF_IGNORE_ATTR, '')
  Object.assign(root.style, {
    position: 'fixed',
    inset: '0',
    pointerEvents: 'none',
    zIndex: String(Z),
    contain: 'strict',
  } as Partial<CSSStyleDeclaration>)
  document.documentElement.appendChild(root)

  const accent = 'var(--vf-accent, var(--primary, #4c8bf5))'

  // A contrast halo that sandwiches the accent border between a DARK and a LIGHT
  // hairline, so the outline stays crisp and legible on ANY background — including a
  // pure-white page (where a white-only ring vanished) and dark/busy ones. The dark
  // ring carries on light backgrounds, the light ring on dark. `EASE` keeps motion smooth.
  const EASE = 'cubic-bezier(.4, 0, .2, 1)'
  const HOVER_HALO = '0 0 0 1px rgba(0,0,0,.45), 0 0 0 2.5px rgba(255,255,255,.6)'
  const ACTIVE_HALO = '0 0 0 1.5px rgba(0,0,0,.5), 0 0 0 3.5px rgba(255,255,255,.65)'
  const hoverBox = div(root, {
    position: 'fixed',
    display: 'none',
    boxSizing: 'border-box',
    border: `2px solid ${accent}`,
    borderRadius: '4px',
    background: 'color-mix(in oklch, var(--vf-accent, #4c8bf5) 8%, transparent)',
    boxShadow: `${HOVER_HALO}, 0 2px 12px -3px color-mix(in oklch, var(--vf-accent, #4c8bf5) 55%, transparent)`,
    transition: `left 70ms ${EASE}, top 70ms ${EASE}, width 70ms ${EASE}, height 70ms ${EASE}`,
    pointerEvents: 'none',
  })
  const activeBox = div(root, {
    position: 'fixed',
    display: 'none',
    boxSizing: 'border-box',
    border: `2px solid ${accent}`,
    borderRadius: '4px',
    // Dark + light halo → accent ring → soft glow: pops off the page on any background.
    boxShadow: `${ACTIVE_HALO}, 0 0 0 5px color-mix(in oklch, var(--vf-accent, #4c8bf5) 30%, transparent), 0 6px 20px -6px color-mix(in oklch, var(--vf-accent, #4c8bf5) 60%, transparent)`,
    pointerEvents: 'none',
  })
  const marquee = div(root, {
    position: 'fixed',
    display: 'none',
    boxSizing: 'border-box',
    border: `1.5px dashed ${accent}`,
    background: 'color-mix(in oklch, var(--vf-accent, #4c8bf5) 8%, transparent)',
    pointerEvents: 'none',
  })
  // Small label showing what the cursor is over (so you know what you'll pick).
  const hoverLabel = div(root, {
    position: 'fixed',
    display: 'none',
    maxWidth: '240px',
    padding: '3px 7px',
    borderRadius: '5px',
    font: '500 11px/1.4 ui-sans-serif, system-ui, sans-serif',
    color: 'var(--vf-accent-foreground, #fff)',
    background: accent,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    boxShadow: '0 0 0 1px rgba(255,255,255,.18), 0 2px 8px rgba(0,0,0,.32)',
    pointerEvents: 'none',
  })
  const markerLayer = div(root, { position: 'fixed', inset: '0', pointerEvents: 'none' })

  let hoverEl: Element | null = null
  let activeEl: Element | null = null
  // Resolved once per setMarks (selector → element + mark node); refresh() only
  // repositions them, so scrolling doesn't re-query the DOM or rebuild nodes.
  let marks: Array<{ el: Element; mark: HTMLDivElement }> = []

  function place(box: HTMLDivElement, el: Element | null) {
    if (!el || !el.isConnected) {
      box.style.display = 'none'
      return
    }
    const r = getViewportRect(el)
    box.style.display = 'block'
    box.style.left = `${r.x}px`
    box.style.top = `${r.y}px`
    box.style.width = `${r.width}px`
    box.style.height = `${r.height}px`
  }

  function positionHover() {
    place(hoverBox, hoverEl)
    if (!hoverEl || !hoverEl.isConnected) {
      hoverLabel.style.display = 'none'
      return
    }
    const r = getViewportRect(hoverEl)
    hoverLabel.style.display = 'block'
    hoverLabel.style.left = `${Math.max(2, r.x)}px`
    const above = r.y - 20
    hoverLabel.style.top = `${above < 2 ? r.y + r.height + 4 : above}px` // flip below near the top edge
  }

  /**
   * Draw what already carries a comment.
   *
   * A numbered pin per comment was the first attempt and it was too loud: circles floating over
   * the very layout being reviewed, each shouting an index nobody needed. This is the plan's
   * idiom instead — the marked thing is tinted, the way a commented sentence is highlighted —
   * so the page still reads as the page.
   */
  function buildMarks(selectors: string[]) {
    markerLayer.textContent = ''
    marks = []
    for (const selector of selectors) {
      let el: Element | null = null
      try {
        el = selector ? document.querySelector(selector) : null
      } catch {
        el = null
      }
      if (!el) continue
      const mark = div(markerLayer, {
        position: 'fixed',
        boxSizing: 'border-box',
        borderRadius: '3px',
        border: `1px solid color-mix(in oklch, ${accent} 55%, transparent)`,
        background: `color-mix(in oklch, ${accent} 12%, transparent)`,
        pointerEvents: 'none',
      })
      marks.push({ el, mark })
    }
    positionMarks()
  }

  function positionMarks() {
    for (const { el, mark } of marks) {
      if (!el.isConnected) {
        mark.style.display = 'none'
        continue
      }
      const r = getViewportRect(el)
      mark.style.display = 'block'
      mark.style.left = `${r.x}px`
      mark.style.top = `${r.y}px`
      mark.style.width = `${r.width}px`
      mark.style.height = `${r.height}px`
    }
  }

  return {
    setHover(el) {
      // The FSM calls this on every pointermove; skip the recompute when the hovered
      // element hasn't changed (scroll/resize repositioning goes through refresh()).
      if (el === hoverEl) return
      hoverEl = el
      if (el?.isConnected) {
        // Summary + size (devtools-style), so you see what and how big before picking.
        const r = getViewportRect(el)
        hoverLabel.textContent = `${getElementSummary(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`
      }
      positionHover()
    },
    setActive(el) {
      activeEl = el
      place(activeBox, el)
    },
    setMarquee(rect) {
      if (!rect) {
        marquee.style.display = 'none'
        return
      }
      marquee.style.display = 'block'
      marquee.style.left = `${rect.x}px`
      marquee.style.top = `${rect.y}px`
      marquee.style.width = `${rect.width}px`
      marquee.style.height = `${rect.height}px`
    },
    setMarks(selectors) {
      buildMarks(selectors)
    },
    refresh() {
      positionHover()
      place(activeBox, activeEl)
      positionMarks()
    },
    destroy() {
      root.remove()
    },
  }
}
