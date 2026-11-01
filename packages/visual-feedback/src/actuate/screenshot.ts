/**
 * The `screenshot` action: locate the target, and rasterize it in-page unless the host captures
 * the pixels itself. Split out of actuate/index.ts so the dispatcher stays a router.
 */

import type { VfCommand } from '../protocol/index'
import type { ActuateDeps, ActuateResult } from './types'
import { getElementSummary } from '../core/identify'
import { getViewportRect } from '../core/geometry'
import { rasterizeElement } from '../rasterize/index'
import { isFail, resolveTarget } from './target'

export async function performScreenshot(cmd: VfCommand, deps: ActuateDeps): Promise<ActuateResult> {
  // Target an element (ref/selector), or the whole page body — or the root — when none given.
  const pageRoot = deps.root ?? document.body ?? document.documentElement
  let target: Element
  if (cmd.ref || cmd.selector) {
    const t = resolveTarget(cmd, deps.reg, deps.root, { observeOnly: true })
    if (isFail(t)) return t
    target = t
  } else {
    target = pageRoot
  }
  // Centering the target makes a small element's shot readable in context — but
  // centering the PAGE ROOT just scrolls a tall page to its middle, which changes
  // what the person watching the preview is looking at and buys nothing (the
  // rasterizer renders the DOM, not the visible pixels). So the whole-page shot
  // leaves the scroll position exactly where it was.
  if (target !== pageRoot && target !== document.documentElement) {
    target.scrollIntoView?.({ block: 'center', inline: 'center' })
  }
  // The host captures the pixels itself: answer where the target is, at once.
  if (cmd.locateOnly) {
    // Instantly: a page-wide `scroll-behavior: smooth` would leave the rect mid-flight.
    if (target !== pageRoot && target !== document.documentElement)
      target.scrollIntoView?.({ block: 'center', inline: 'center', behavior: 'instant' })
    return {
      ok: true,
      result: {
        action: 'screenshot',
        rect: getViewportRect(target),
        target: getElementSummary(target),
        viewport: { width: window.innerWidth, height: window.innerHeight },
      },
    }
  }
  // Rasterize IN-PAGE (same origin) — no screen-share permission, works headless.
  // A whole-view shot is OF the view, so it takes no context margin. The margin makes a small
  // element readable among its neighbours; around a scoped root (a plugin panel inside the app)
  // it sent the rasterizer climbing to the app shell for pixels outside the panel, cloning the
  // whole window — and WebKit's per-image redraw pass made that ~16 s a shot.
  const image = await rasterizeElement(target, {
    ...(deps.backdrop ? { backgroundColor: deps.backdrop } : {}),
    ...(target === pageRoot ? { contextRatio: 0 } : {}),
  })
  return {
    ok: true,
    result: {
      action: 'screenshot',
      rect: getViewportRect(target),
      target: getElementSummary(target),
      ...(image ? { image } : { note: 'could not rasterize this element' }),
    },
  }
}
