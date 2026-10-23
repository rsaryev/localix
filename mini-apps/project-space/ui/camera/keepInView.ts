import type { CameraViewport } from '@localixai/kit/canvas'
import type { Box } from '../../shared/ops/geometry'
import { frameViewport } from './framing'

/**
 * The least move that brings what has the focus fully into view. The camera FOLLOWS the focus rather than re-framing it: a focus
 * already in view does not move the camera at all, one partly off screen slides in just far
 * enough to clear the edge by `margin` screen pixels, at the zoom the person chose. Only a focus
 * larger than the view zooms out, to fit it whole (the board's framing, never past 100 %).
 *
 * This is for a focus that changed on its own (a drag-select, the agent moving what you look
 * at); a DELIBERATE one goes to the thing instead (`framing.ts`'s `focusViewport`).
 */
export function keepInView(
  rect: Box,
  viewport: CameraViewport,
  size: { width: number; height: number },
  margin: number,
): CameraViewport | null {
  const { zoom } = viewport
  const room = { w: size.width - margin * 2, h: size.height - margin * 2 }
  if (rect.w * zoom > room.w || rect.h * zoom > room.h) return frameViewport(rect, size, 'many')
  // The rectangle on screen, and how far each axis must slide to clear the margins.
  const left = rect.x * zoom + viewport.x
  const top = rect.y * zoom + viewport.y
  const right = left + rect.w * zoom
  const bottom = top + rect.h * zoom
  const dx =
    left < margin ? margin - left : right > size.width - margin ? size.width - margin - right : 0
  const dy =
    top < margin ? margin - top : bottom > size.height - margin ? size.height - margin - bottom : 0
  if (dx === 0 && dy === 0) return null
  return { x: viewport.x + dx, y: viewport.y + dy, zoom }
}
