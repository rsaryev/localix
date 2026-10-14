import type { SpaceDocument, SpaceElement } from './format/document'
import type { CameraMove, Subject } from './camera'
import { spaceTypes } from './types'
import { SpaceDraft } from './ops/draft'
import { contentBounds, overlaps, type Box } from './ops/geometry'
import { resolveTargets } from './ops/groups'
import { boundsOfBoxes } from './ops/layout'

/**
 * What the agent asked the camera for, as one move — decided on the board's own geometry, so the
 * tab only has to frame a rectangle or apply a zoom or a slide. The order is the order a question
 * is answered in: WHAT to look at (elements, an area, the whole board), then HOW CLOSE (a zoom),
 * and a slide only when nothing is named to look at.
 */
export interface CameraRequest {
  /** Elements, groups or frames to frame together. */
  focus?: readonly string[]
  /** A board rectangle to frame. */
  area?: Box
  /** Frame everything on the board. */
  fit?: boolean
  /** A zoom (0.1–2.5): about what is framed, or about the centre of the view. */
  zoom?: number
  /** Slide by fractions of the view: `{ x: 0.5 }` is half a screen to the right. */
  pan?: { x?: number; y?: number }
}

/**
 * What a set of elements is to the framing: ONE element (brought to a reading size) or several —
 * and a frame counts as several, since what it is for is what it holds, fitted whole. One answer
 * for the agent's `space_view`, a click, and following someone's change.
 */
export function subjectOf(space: SpaceDocument, ids: readonly string[]): Subject {
  const [only] = ids
  if (ids.length !== 1 || !only) return 'many'
  const element = space.elements[only]
  return element && spaceTypes.get(element.type)?.container !== true ? 'one' : 'many'
}

export function cameraMove(space: SpaceDocument, request: CameraRequest): CameraMove | string {
  const zoom = request.zoom
  const framed = (rect: Box): Extract<CameraMove, { kind: 'frame' }> => ({
    kind: 'frame',
    rect,
    ...(zoom !== undefined ? { zoom } : {}),
  })
  if (request.focus?.length) {
    const resolved = resolveTargets(new SpaceDraft(space), request.focus)
    if ('error' in resolved) return resolved.error.ok ? 'nothing to look at' : resolved.error.error
    return {
      ...framed(boundsOfBoxes(resolved.ids.map((id) => space.elements[id] as SpaceElement))),
      subject: subjectOf(space, resolved.ids),
      spotlight: resolved.ids,
    }
  }
  if (request.area) {
    if (!(request.area.w > 0 && request.area.h > 0)) return 'an area needs a width and a height'
    return framed(request.area)
  }
  if (request.fit) {
    const bounds = contentBounds(space)
    return bounds ? framed(bounds) : 'the board is empty: there is nothing to fit'
  }
  if (request.pan && (request.pan.x || request.pan.y))
    return { kind: 'pan', x: request.pan.x ?? 0, y: request.pan.y ?? 0 }
  if (zoom !== undefined) return { kind: 'zoom', zoom }
  return 'say where to look: focus (ids), area, fit, pan, or zoom'
}

/** The elements a board rectangle shows, bottom to top as the roster lists them. */
export function elementsIn(space: SpaceDocument, rect: Box): string[] {
  return Object.entries(space.elements)
    .filter(([, element]) => overlaps(rect, element))
    .map(([id]) => id)
}
