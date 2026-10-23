import { CAMERA_ZOOM, centerOn, fitViewport, type CameraViewport } from '@localixai/kit/canvas'
import { FRAME_ZOOM_CAP, type Subject } from '../../shared/camera'
import type { Box } from '../../shared/ops/geometry'

/**
 * How close the camera comes to what it is asked to show — ONE policy, used by the agent's
 * `space_view`, a deliberate focus (a click, Tab, the layers panel), "zoom to selection" and
 * following the agent's changes, so the board frames a thing the same way whoever asked.
 *
 * The board's plain fit never enlarges past 100 %, which is right for a region and wrong for ONE
 * element: "show me this card" left a small note small in the middle of the screen. A single
 * element is brought to a reading size instead — the middle half of the view, up to 125 % — while
 * several elements or a frame are fitted whole, never past 100 %. A zoom the caller names wins.
 */
export type { Subject } from '../../shared/camera'

/**
 * The share of the view kept free on EACH side around one element: it fills the middle half, with
 * its neighbours still in sight. Filling 70 % up to 160 % came too close to read around it.
 */
const ONE_PADDING = 0.25

export function frameViewport(
  rect: Box,
  size: { width: number; height: number },
  subject: Subject,
  zoom?: number,
): CameraViewport {
  const bounds = { x: rect.x, y: rect.y, width: rect.w, height: rect.h }
  if (zoom !== undefined)
    return fitViewport(bounds, size, { maxZoom: zoom, limits: { min: zoom, max: zoom } })
  return fitViewport(bounds, size, {
    maxZoom: FRAME_ZOOM_CAP[subject],
    ...(subject === 'one' ? { padding: ONE_PADDING } : {}),
  })
}

/**
 * Where a DELIBERATE focus takes the camera — a click on an element, Tab to the next, a pick in
 * the layers panel: to the thing, CENTRED, at a reading size (`frameViewport`), because a person
 * who picks a card wants to read it with what surrounds it in sight. But never AWAY from what
 * they already read closer: a view that close keeps its zoom and only brings the focus to the
 * middle — stepping card to card then moves the board under you, with the next ones showing
 * around it, instead of a camera that stood still while the focus crept to the edge. A focus
 * already about in the middle moves nothing (null): no flight for a few pixels.
 */
export function focusViewport(
  rect: Box,
  subject: Subject,
  viewport: CameraViewport,
  size: { width: number; height: number },
): CameraViewport | null {
  const target = frameViewport(rect, size, subject)
  if (viewport.zoom < target.zoom * CLOSE_ENOUGH) return target
  const { zoom } = viewport
  // Larger than the view even at this zoom: the whole of it, as the framing has it.
  if (rect.w * zoom > size.width || rect.h * zoom > size.height) return target
  const centred = centerOn({ x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 }, size, zoom)
  const off = Math.hypot(centred.x - viewport.x, centred.y - viewport.y)
  return off <= Math.min(size.width, size.height) * CENTRED_ENOUGH ? null : centred
}

/** Within 8 % of the reading zoom is reading zoom: no flight for a nudge of the zoom. */
const CLOSE_ENOUGH = 0.92
/** Within 4 % of the view's shorter side of the middle is the middle. */
const CENTRED_ENOUGH = 0.04

/**
 * "Zoom to selection", twice: away from 100 % the first press brings the selection to
 * 100 % (or as close as still shows all of it); at 100 % it frames the selection whole. So one
 * key both reads a thing at its natural size and takes it in at a glance.
 */
export function selectionViewport(
  rect: Box,
  size: { width: number; height: number },
  current: CameraViewport,
): CameraViewport {
  if (Math.abs(current.zoom - 1) < 0.01)
    return fitViewport({ x: rect.x, y: rect.y, width: rect.w, height: rect.h }, size, {
      maxZoom: CAMERA_ZOOM.max,
    })
  // min(100 %, the fit): 100 % when it all shows there, else as close as still shows all of it.
  return frameViewport(rect, size, 'many')
}

/**
 * A frame presented as a slide: as large as the view holds it, a margin of 4 % round it — the one
 * framing that may pass 100 %, because a slide is read from across a room, not edited.
 */
export function presentViewport(
  rect: Box,
  size: { width: number; height: number },
): CameraViewport {
  return fitViewport({ x: rect.x, y: rect.y, width: rect.w, height: rect.h }, size, {
    maxZoom: CAMERA_ZOOM.max,
    padding: 0.04,
  })
}
