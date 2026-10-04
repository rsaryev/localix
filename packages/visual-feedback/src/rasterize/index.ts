/**
 * In-probe element rasterizer — turns a DOM element into a JPEG WITHOUT any
 * permission. The probe runs same-origin with the previewed page, so it can render
 * the page's own DOM to a canvas directly; the host (a cross-origin parent) cannot,
 * which is why the old path needed a `getDisplayMedia` screen-share consent.
 *
 * Built on `modern-screenshot` (the foreignObject/SVG technique — the browser renders
 * a serialized SVG of the node, so CSS fidelity is high) with agent-tuned defaults:
 * JPEG and a hard size cap. Fonts are embedded and the page background is preserved:
 * typography and color are evidence in visual review, not optional decoration.
 *
 * A bare element-clipped shot is edge-to-edge and crops anything that overflows the
 * border-box (badges, shadows) — and gives the model no surrounding context to locate
 * the element. So we capture the element PLUS a margin of real page pixels: render the
 * smallest ancestor that contains `element + margin`, then crop to that region. (We
 * can't pad via modern-screenshot's width/height — those force the node's size, which
 * stretches the capture.)
 *
 * Known limits (acceptable for agent reads): cross-origin images without CORS are
 * dropped, and it's a re-render, not exact compositor pixels.
 */

import { domToCanvas, domToJpeg } from 'modern-screenshot'

import type { VfImage } from '../protocol/index'
import { VF_IGNORE_ATTR } from '../protocol/index'

export interface RasterizeOptions {
  /** Longest output edge in px before downscaling (default 1000). */
  maxEdge?: number
  /** JPEG quality 0–1 (default 0.92). */
  quality?: number
  /** Explicit JPEG backdrop. Omit to derive it from the rendered page. */
  backgroundColor?: string
  /** Embed web fonts (default true for screenshot fidelity). */
  embedFonts?: boolean
  /** Context margin around the element, as a fraction of its longest edge (default 0.15,
   *  capped at `maxContextPx`). 0 disables context (tight element-only crop). */
  contextRatio?: number
  /** Hard cap on the context margin in CSS px (default 56). */
  maxContextPx?: number
}

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

const covers = (outer: DOMRect, r: Box) =>
  outer.left <= r.left + 0.5 &&
  outer.top <= r.top + 0.5 &&
  outer.right >= r.right - 0.5 &&
  outer.bottom >= r.bottom - 0.5

const isOpaqueColor = (color: string): boolean => {
  const normalized = color.trim().toLowerCase()
  if (!normalized || normalized === 'transparent') return false
  const rgba = normalized.match(/^rgba\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)$/)
  return !rgba || Number(rgba[1]) >= 1
}

/** JPEG cannot retain alpha. Find the page paint beneath a transparent capture. */
export function resolveRasterBackdrop(el: Element, explicit?: string): string {
  if (explicit) return explicit
  for (let current: Element | null = el; current; current = current.parentElement) {
    const color = getComputedStyle(current).backgroundColor
    // A translucent element background is already painted by the cloned DOM. Use
    // the first opaque layer beneath it as the JPEG canvas backdrop.
    if (isOpaqueColor(color)) return color
  }
  return '#ffffff'
}

/** Do not photograph the picker outline, pins, or injected probe artifacts. */
export function includeInRaster(node: Node): boolean {
  return !(node instanceof Element && node.hasAttribute(VF_IGNORE_ATTR))
}

/** Let loaded web fonts settle without allowing a broken font request to stall feedback. */
async function waitForFonts(timeoutMs = 1_500): Promise<void> {
  await Promise.race([
    document.fonts.ready.then(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
  ])
}

/** Give selection effects and React layout two opportunities to reach the renderer. */
async function waitForStablePaint(): Promise<void> {
  for (let frame = 0; frame < 2; frame++) {
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        resolve()
      }
      requestAnimationFrame(finish)
      setTimeout(finish, 100)
    })
  }
}

/** The page root: a shot of it means the SCREEN, not a very tall document. */
function isPageRoot(el: Element): boolean {
  return el === document.body || el === document.documentElement
}

/**
 * Render what is on screen right now — the viewport, not the document.
 *
 * Asking for a shot of `body` on a long page renders the whole document: on anything
 * substantial that is slow, and past the 8-second budget it produces nothing at all, which is
 * how a comment about the screen ended up with no picture attached. A person pointing at "the
 * whole page" means the part of it they can see, so this renders exactly that: the root at
 * viewport size, translated by the scroll offset.
 */
export async function rasterizeViewport(opts: RasterizeOptions = {}): Promise<VfImage | null> {
  const maxEdge = opts.maxEdge ?? 1000
  const quality = opts.quality ?? 0.92
  const embedFonts = opts.embedFonts ?? true
  if (embedFonts) await waitForFonts()
  await waitForStablePaint()

  const root = document.documentElement
  const vw = Math.max(1, window.innerWidth)
  const vh = Math.max(1, window.innerHeight)
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3))
  const scale = Math.min(dpr, maxEdge / Math.max(vw, vh))

  try {
    const canvas = await domToCanvas(root, {
      scale,
      width: vw,
      height: vh,
      // The clone is laid out from the document's origin, so the visible band is brought up
      // into the frame by the current scroll offset.
      style: {
        transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)`,
        transformOrigin: 'top left',
      },
      backgroundColor: opts.backgroundColor ?? resolveRasterBackdrop(document.body ?? root),
      font: embedFonts ? {} : false,
      features: { restoreScrollPosition: true },
      timeout: 8_000,
      filter: includeInRaster,
    })
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    return {
      data: dataUrl.slice(comma + 1),
      mediaType: 'image/jpeg',
      width: canvas.width,
      height: canvas.height,
    }
  } catch {
    return null
  }
}

/**
 * Render `el` (with a margin of surrounding context) to a clamped JPEG, or null if it
 * isn't laid out / rendering failed. A page root is answered with the viewport shot above.
 */
export async function rasterizeElement(
  el: Element,
  opts: RasterizeOptions = {},
): Promise<VfImage | null> {
  if (isPageRoot(el)) return rasterizeViewport(opts)
  const maxEdge = opts.maxEdge ?? 1000
  const quality = opts.quality ?? 0.92
  const embedFonts = opts.embedFonts ?? true
  if (embedFonts) await waitForFonts()
  await waitForStablePaint()

  // Measure only after fonts and selection-triggered UI updates have settled. These
  // coordinates must describe the same layout that modern-screenshot will clone.
  const vr = el.getBoundingClientRect()
  if (vr.width < 1 || vr.height < 1) return null
  const backdrop = resolveRasterBackdrop(el, opts.backgroundColor)
  // Render at the device pixel ratio so the capture is CRISP on HiDPI/Retina screens
  // (passing `scale` overrides modern-screenshot's default DPR, so we fold it in here).
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3))

  // The region we WANT in the shot: the element plus a margin of context, clamped to the
  // viewport so we never ask for off-screen pixels.
  const ratio = opts.contextRatio ?? 0.15
  const margin = Math.round(
    Math.min(Math.max(vr.width, vr.height) * ratio, opts.maxContextPx ?? 56),
  )
  const vw = window.innerWidth,
    vh = window.innerHeight
  let region: Box = {
    left: Math.max(0, vr.left - margin),
    top: Math.max(0, vr.top - margin),
    right: Math.min(vw, vr.right + margin),
    bottom: Math.min(vh, vr.bottom + margin),
  }

  try {
    // Pick the smallest ancestor that fully contains the region, so we rasterize as
    // little as possible while still having every pixel of the desired crop. Bounded
    // climb so we never walk past a sane container into a giant full-page wrapper.
    let container: Element = el
    for (let hops = 0; hops < 12 && container.parentElement; hops++) {
      if (covers(container.getBoundingClientRect(), region)) break
      container = container.parentElement
    }
    let cr = container.getBoundingClientRect()
    // If even the top ancestor doesn't cover the margin region (element flush to an
    // edge), clamp the region back inside what we'll actually render.
    region = {
      left: Math.max(region.left, cr.left),
      top: Math.max(region.top, cr.top),
      right: Math.min(region.right, cr.right),
      bottom: Math.min(region.bottom, cr.bottom),
    }
    const regionW = Math.max(1, region.right - region.left)
    const regionH = Math.max(1, region.bottom - region.top)

    // Downscale so the longest edge of the CROP stays within maxEdge.
    const scale = Math.min(dpr, maxEdge / Math.max(regionW, regionH))

    const canvas = await domToCanvas(container as HTMLElement, {
      scale,
      // Never override the cloned ancestor's real paint. `backgroundColor` is
      // applied to that clone with !important by modern-screenshot.
      backgroundColor: null,
      font: embedFonts ? {} : false,
      features: { restoreScrollPosition: true },
      timeout: 8_000,
      filter: includeInRaster,
    })
    cr = container.getBoundingClientRect() // re-read post-render (layout shouldn't move, but be safe)

    // Crop the rendered ancestor canvas down to just the region (element + context).
    const sx = Math.round((region.left - cr.left) * scale)
    const sy = Math.round((region.top - cr.top) * scale)
    const sw = Math.max(1, Math.round(regionW * scale))
    const sh = Math.max(1, Math.round(regionH * scale))
    const out = document.createElement('canvas')
    out.width = sw
    out.height = sh
    const ctx = out.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = backdrop
    ctx.fillRect(0, 0, sw, sh)
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, sw, sh)
    const dataUrl = out.toDataURL('image/jpeg', quality)
    const comma = dataUrl.indexOf(',')
    if (comma < 0) return null
    return { data: dataUrl.slice(comma + 1), mediaType: 'image/jpeg', width: sw, height: sh }
  } catch {
    // Last-ditch: a tight element-only shot (better than nothing if the crop path threw).
    try {
      const longest = Math.max(vr.width, vr.height)
      const scale = Math.min(dpr, maxEdge / longest)
      const dataUrl = await domToJpeg(el as HTMLElement, {
        quality,
        scale,
        backgroundColor: opts.backgroundColor ?? backdrop,
        font: embedFonts ? {} : false,
        features: { restoreScrollPosition: true },
        timeout: 8_000,
        filter: includeInRaster,
      })
      const comma = dataUrl.indexOf(',')
      if (comma < 0) return null
      return {
        data: dataUrl.slice(comma + 1),
        mediaType: 'image/jpeg',
        width: Math.max(1, Math.round(vr.width * scale)),
        height: Math.max(1, Math.round(vr.height * scale)),
      }
    } catch {
      return null
    }
  }
}
