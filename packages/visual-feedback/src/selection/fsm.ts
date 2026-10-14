/**
 * Selection controller — pointer/keyboard/selection state machine for the probe.
 * Modes: hover (outline follows cursor), click (pick one element), drag (marquee →
 * area or multi pick), and text (browser text selection → pick the range's element).
 *
 * Gotchas handled: pierces shadow DOM via deepElementFromPoint; skips the probe's
 * own overlay (`[data-vf-ignore]`) using composedPath; distinguishes click from
 * drag by a squared 8px threshold; reads text selection before treating a pointerup
 * as a click.
 */

import { VF_IGNORE_ATTR } from '../protocol/index'
import { deepElementFromPoint } from '../core/identify'

const DRAG_THRESHOLD_SQ = 64 // 8px, compared squared to avoid sqrt

export interface PickEvent {
  kind: 'element' | 'text' | 'area' | 'multi'
  element: Element | null
  members?: Element[]
  rect?: { x: number; y: number; width: number; height: number }
  text?: string
  /** The area IS the window: a comment about the whole screen rather than a part of it. */
  page?: boolean
}

/**
 * How much of the window a drag has to sweep before it stops being a region and starts being
 * the screen. Deliberately short of the full window in both axes: nobody drags to the exact
 * pixel corners, and the scrollbar, the padding and the moment the pointer leaves the frame
 * all eat the last few percent.
 */
const VIEWPORT_SWEEP = 0.82

function coversViewport(x1: number, y1: number, x2: number, y2: number): boolean {
  const width = Math.abs(x2 - x1)
  const height = Math.abs(y2 - y1)
  return (
    width >= window.innerWidth * VIEWPORT_SWEEP && height >= window.innerHeight * VIEWPORT_SWEEP
  )
}

export interface PickerCallbacks {
  onHover(el: Element | null): void
  onMarquee(rect: { x: number; y: number; width: number; height: number } | null): void
  onPick(ev: PickEvent): void
}

function isOwn(target: EventTarget | null): boolean {
  const el = target as Element | null
  return !!el?.closest?.(`[${VF_IGNORE_ATTR}]`)
}

/** True if the event's real target (composedPath head) is part of the probe overlay. */
function eventHitsOverlay(e: Event): boolean {
  const path = e.composedPath?.()
  const head = path?.[0] as Element | undefined
  return isOwn(head ?? (e.target as Element | null))
}

function collectMarqueeTargets(
  left: number,
  top: number,
  right: number,
  bottom: number,
): Element[] {
  const tags = 'a,button,input,img,p,h1,h2,h3,h4,h5,h6,li,label,section,article,nav,header,footer'
  const out: Element[] = []
  for (const el of Array.from(document.querySelectorAll(tags))) {
    if (isOwn(el)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 8 || r.height < 8) continue
    const cx = r.left + r.width / 2
    const cy = r.top + r.height / 2
    if (cx >= left && cx <= right && cy >= top && cy <= bottom) out.push(el)
  }
  // Drop ancestors that fully contain another selected element (keep the leaves).
  return out.filter((el) => !out.some((o) => o !== el && el.contains(o)))
}

export interface Picker {
  setEnabled(on: boolean): void
  destroy(): void
}

export function createPicker(cb: PickerCallbacks): Picker {
  let enabled = false
  let downX = 0,
    downY = 0,
    dragging = false,
    downOnEl: Element | null = null

  const onMove = (e: PointerEvent) => {
    if (!enabled) return
    if (downOnEl !== null) {
      // potential drag
      const dx = e.clientX - downX,
        dy = e.clientY - downY
      if (!dragging && dx * dx + dy * dy >= DRAG_THRESHOLD_SQ) dragging = true
      if (dragging) {
        const sweepingScreen = coversViewport(downX, downY, e.clientX, e.clientY)
        // If the drag is selecting text, let the browser show its selection and hide the
        // marquee box (it would be a confusing overlay over the text). A sweep that has grown
        // to the size of the window is past that: it is aiming at the screen, so the marquee
        // comes back and the stray selection goes.
        if (!sweepingScreen && window.getSelection()?.toString()) {
          cb.onMarquee(null)
          return
        }
        if (sweepingScreen) window.getSelection()?.removeAllRanges()
        const left = Math.min(downX, e.clientX),
          top = Math.min(downY, e.clientY)
        cb.onMarquee({
          x: left,
          y: top,
          width: Math.abs(e.clientX - downX),
          height: Math.abs(e.clientY - downY),
        })
        return
      }
    }
    if (eventHitsOverlay(e)) return
    const el = deepElementFromPoint(e.clientX, e.clientY)
    cb.onHover(el && !isOwn(el) ? el : null)
  }

  const onDown = (e: PointerEvent) => {
    if (!enabled || e.button !== 0 || eventHitsOverlay(e)) return
    downX = e.clientX
    downY = e.clientY
    dragging = false
    downOnEl = deepElementFromPoint(e.clientX, e.clientY)
  }

  const onUp = (e: PointerEvent) => {
    if (!enabled) return
    const wasDragging = dragging
    const startEl = downOnEl
    downOnEl = null
    dragging = false
    cb.onMarquee(null)
    if (eventHitsOverlay(e)) return

    const sel = window.getSelection()
    const selText = sel?.toString().trim()

    // Sweeping most of the window is a comment about the SCREEN, not about the words the
    // sweep happened to cross. Text selection used to win every drag, so "select the whole
    // page" quietly produced a quote of whatever prose was in the way — the one thing you
    // could not comment on was the layout as a whole.
    if (wasDragging && coversViewport(downX, downY, e.clientX, e.clientY)) {
      sel?.removeAllRanges()
      cb.onPick({
        kind: 'area',
        element: document.body,
        rect: { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
        page: true,
      })
      return
    }

    // Otherwise a text selection (from click-and-drag over text, or a double-click) takes
    // priority — that's the user's intent even though it also looks like a drag.
    if (selText) {
      const anchor = (
        sel?.anchorNode?.nodeType === 3 ? sel.anchorNode.parentElement : sel?.anchorNode
      ) as Element | null
      cb.onPick({ kind: 'text', element: anchor ?? startEl, text: selText.slice(0, 500) })
      sel?.removeAllRanges()
      return
    }

    // A marquee drag over non-text regions → area / multi-element pick.
    if (wasDragging) {
      const left = Math.min(downX, e.clientX),
        top = Math.min(downY, e.clientY)
      const right = Math.max(downX, e.clientX),
        bottom = Math.max(downY, e.clientY)
      if (right - left < 12 || bottom - top < 12) return
      const members = collectMarqueeTargets(left, top, right, bottom)
      const rect = { x: left, y: top, width: right - left, height: bottom - top }
      if (members.length > 1) cb.onPick({ kind: 'multi', element: members[0], members, rect })
      else cb.onPick({ kind: 'area', element: members[0] ?? null, rect })
      return
    }

    // Otherwise a plain click → single element.
    const el = startEl && !isOwn(startEl) ? startEl : deepElementFromPoint(e.clientX, e.clientY)
    if (el && !isOwn(el)) cb.onPick({ kind: 'element', element: el })
  }

  // In comment mode, swallow native clicks on links/buttons so picking doesn't navigate.
  const onClickCapture = (e: MouseEvent) => {
    if (!enabled || eventHitsOverlay(e)) return
    e.preventDefault()
    e.stopPropagation()
  }

  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('click', onClickCapture, true)

  return {
    setEnabled(on) {
      enabled = on
      if (!on) {
        cb.onHover(null)
        cb.onMarquee(null)
        downOnEl = null
        dragging = false
      }
    },
    destroy() {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('pointerup', onUp, true)
      document.removeEventListener('click', onClickCapture, true)
    },
  }
}
