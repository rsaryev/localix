/**
 * In-page overlay — the hover outline, the selected element or area, the drag marquee, and a
 * quiet tint on everything that already carries a comment.
 *
 * It lives in a shadow root under one `position:fixed` host (see `styles.ts` for why), and it
 * FOLLOWS what it outlines: a scroll, a resize or any change to the page's DOM schedules one
 * re-measure on the next frame. Positions used to be re-read on scroll and resize only, so an
 * image that loaded, an accordion that opened or a framework re-render left the outline on empty
 * space and the comment tints on the wrong elements.
 *
 * Every node is unreachable to the picker: the host carries `data-vf-ignore` and is
 * `pointer-events:none`, and rasterized screenshots skip it.
 */

import { VF_IGNORE_ATTR, type VfRect } from '../protocol/index'
import { getViewportRect } from '../core/geometry'
import { getElementSummary } from '../core/identify'
import { OVERLAY_CSS } from './styles'

/** A comment's mark: which element it is on, and what the person sees when they point at it. */
export interface OverlayMark {
  id: string
  selector: string
  /** Its number in the comment list, as the composer shows it. */
  index: number
  note: string
}

/** What is selected: one element, or a dragged area (optionally with the elements it caught). */
export type OverlayTarget = { element: Element } | { area: VfRect; members?: Element[] }

export interface Overlay {
  setHover(el: Element | null): void
  setActive(target: OverlayTarget | null): void
  /** The selected target's current viewport rect, or null. */
  activeRect(): VfRect | null
  setMarquee(rect: VfRect | null): void
  setMarks(marks: OverlayMark[]): void
  /** The mark on exactly this element, if one is there. */
  markOf(el: Element): OverlayMark | null
  /** Draw the eye to the selected target (a comment revealed from the host). */
  pulse(): void
  refresh(): void
  destroy(): void
}

const Z = '2147483647'

export function createOverlay(options: { onLayout?: () => void } = {}): Overlay {
  const host = document.createElement('div')
  host.setAttribute(VF_IGNORE_ATTR, '')
  host.setAttribute('aria-hidden', 'true')
  // Inline, so no page rule can move or hide the host itself.
  host.style.cssText = `all:initial;position:fixed;inset:0;pointer-events:none;z-index:${Z};`
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = OVERLAY_CSS
  const root = document.createElement('div')
  root.className = 'root'
  shadow.append(style, root)
  document.documentElement.appendChild(host)

  const node = (className: string) => {
    const el = document.createElement('div')
    el.className = className
    root.appendChild(el)
    return el
  }
  const markLayer = node('marks')
  const hoverBox = node('box hover')
  const activeBox = node('box active')
  const marquee = node('box marquee')
  const label = node('label')

  let hoverEl: Element | null = null
  let active: (OverlayTarget & { scroll: { x: number; y: number } }) | null = null
  let marks: Array<OverlayMark & { el: Element | null; box: HTMLDivElement }> = []

  function show(box: HTMLElement, rect: VfRect | null) {
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      box.removeAttribute('data-on')
      return
    }
    box.setAttribute('data-on', '')
    box.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`
    box.style.width = `${rect.width}px`
    box.style.height = `${rect.height}px`
  }

  const liveRect = (el: Element | null) => (el?.isConnected ? getViewportRect(el) : null)

  function resolve(selector: string): Element | null {
    try {
      return selector ? document.querySelector(selector) : null
    } catch {
      return null
    }
  }

  function currentActiveRect(): VfRect | null {
    if (!active) return null
    if ('element' in active) return liveRect(active.element)
    const members = active.members?.filter((el) => el.isConnected) ?? []
    if (members.length) return union(members.map(getViewportRect))
    // An area is a place on the page: it scrolls with the document.
    return {
      ...active.area,
      x: active.area.x - (window.scrollX - active.scroll.x),
      y: active.area.y - (window.scrollY - active.scroll.y),
    }
  }

  function placeLabel() {
    const rect = liveRect(hoverEl)
    if (!rect) {
      label.removeAttribute('data-on')
      return
    }
    label.setAttribute('data-on', '')
    const width = label.offsetWidth
    const x = Math.max(4, Math.min(rect.x, window.innerWidth - width - 4))
    const above = rect.y - 22
    const below = rect.y + rect.height + 4
    // Above the element; below it near the top edge; inside its top when it fills the screen.
    const y =
      above >= 4 ? above : below + 20 <= window.innerHeight ? below : Math.max(4, rect.y + 4)
    label.style.transform = `translate3d(${x}px, ${y}px, 0)`
  }

  function measure() {
    show(hoverBox, liveRect(hoverEl))
    placeLabel()
    show(activeBox, currentActiveRect())
    for (const mark of marks) {
      // A re-render replaces the element the selector named: find the new one.
      if (!mark.el?.isConnected) mark.el = resolve(mark.selector)
      show(mark.box, liveRect(mark.el))
    }
    options.onLayout?.()
  }

  // One re-measure per frame, through the rAF the page had when the probe mounted: a page that
  // patches `requestAnimationFrame` later must not decide when the overlay moves.
  const raf = window.requestAnimationFrame.bind(window)
  let scheduled = 0
  const schedule = () => {
    if (!scheduled) scheduled = raf(() => ((scheduled = 0), measure()))
  }
  const mutations = new MutationObserver(() => {
    if (hoverEl || active || marks.length) schedule()
  })
  mutations.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  })
  const listen = { capture: true, passive: true } as const
  window.addEventListener('scroll', schedule, listen)
  window.addEventListener('resize', schedule, { passive: true })

  function describe(el: Element): void {
    const mark = overlay.markOf(el)
    label.textContent = ''
    if (mark) {
      const number = document.createElement('b')
      number.textContent = `#${mark.index}`
      label.append(number, mark.note ? `“${mark.note}”` : getElementSummary(el))
      hoverBox.setAttribute('data-marked', '')
      return
    }
    hoverBox.removeAttribute('data-marked')
    const r = getViewportRect(el)
    label.textContent = `${getElementSummary(el)} · ${Math.round(r.width)}×${Math.round(r.height)}`
  }

  const overlay: Overlay = {
    setHover(el) {
      if (el === hoverEl) return
      hoverEl = el
      if (el?.isConnected) describe(el)
      measure()
    },
    setActive(target) {
      active = target ? { ...target, scroll: { x: window.scrollX, y: window.scrollY } } : null
      activeBox.removeAttribute('data-pulse')
      activeBox.removeAttribute('data-enter')
      if (active) {
        void activeBox.offsetWidth // restart the entrance for a new selection
        activeBox.setAttribute('data-enter', '')
      }
      measure()
    },
    activeRect: currentActiveRect,
    setMarquee(rect) {
      show(marquee, rect)
    },
    setMarks(next) {
      markLayer.textContent = ''
      marks = next.map((mark) => {
        const box = document.createElement('div')
        box.className = 'box mark'
        markLayer.appendChild(box)
        return { ...mark, el: resolve(mark.selector), box }
      })
      if (hoverEl?.isConnected) describe(hoverEl)
      measure()
    },
    markOf(el) {
      for (let i = marks.length - 1; i >= 0; i--) {
        const mark = marks[i]!
        if (!mark.el?.isConnected) mark.el = resolve(mark.selector)
        if (mark.el === el) return mark
      }
      return null
    },
    pulse() {
      if (!active) return
      activeBox.removeAttribute('data-pulse')
      void activeBox.offsetWidth
      activeBox.setAttribute('data-pulse', '')
    },
    refresh: measure,
    destroy() {
      mutations.disconnect()
      window.removeEventListener('scroll', schedule, listen)
      window.removeEventListener('resize', schedule)
      host.remove()
    },
  }
  return overlay
}

function union(rects: VfRect[]): VfRect {
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
