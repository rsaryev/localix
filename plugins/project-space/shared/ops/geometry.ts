import type { TypeRegistry } from '../registry/registry'
import type { SpaceDocument, SpaceElement } from '../format/document'
import { boundsOfBoxes } from './layout'

/**
 * The board's geometry questions: what a frame holds, and where a new element may go.
 *
 * Membership is containment — every corner of the element inside the frame — so it is decided
 * here, from positions, and never stored (see `format/schema.ts`). Placement is what lets the
 * agent create an element without coordinates (a model rarely emits useful ones): code picks the
 * first free spot next to what the element belongs with, which is also what keeps the agent from
 * stacking twenty cards on one point.
 */
export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export const GAP = 40
/** A frame's padding; its content starts two insets down, below the title. */
export const INSET = 24

export function contains(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  )
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

const isContainer = (registry: TypeRegistry, element: SpaceElement) =>
  registry.get(element.type)?.container === true

/** Every element a container holds, nested frames and what they hold included. */
export function membersOf(space: SpaceDocument, id: string, registry: TypeRegistry): string[] {
  const frame = space.elements[id]
  if (!frame || !isContainer(registry, frame)) return []
  return Object.entries(space.elements)
    .filter(([other, element]) => other !== id && contains(frame, element))
    .map(([other]) => other)
}

/** The innermost container holding an element — the frame a person sees it in. */
export function frameOf(space: SpaceDocument, id: string, registry: TypeRegistry): string | null {
  const element = space.elements[id]
  if (!element) return null
  let best: { id: string; area: number } | null = null
  for (const [other, candidate] of Object.entries(space.elements)) {
    if (other === id || !isContainer(registry, candidate) || !contains(candidate, element)) continue
    const area = candidate.w * candidate.h
    if (!best || area < best.area) best = { id: other, area }
  }
  return best?.id ?? null
}

/**
 * The free spot for a box closest to `point` (its centre), searched ring by ring outward — where
 * a dropped file lands. Four files dropped in one spot used to land on top of each other and read
 * as one card; each now takes the nearest place nothing else holds. `also` are boxes placed in
 * the same batch, not yet on the board. Frames do not count as taken: a drop into a frame is
 * a drop into it.
 */
export function placeNear(
  space: SpaceDocument,
  size: { w: number; h: number },
  point: { x: number; y: number },
  registry: TypeRegistry,
  also: readonly Box[] = [],
): { x: number; y: number } {
  const taken = [
    ...Object.values(space.elements).filter((element) => !isContainer(registry, element)),
    ...also,
  ]
  const origin = { x: point.x - size.w / 2, y: point.y - size.h / 2 }
  const free = (x: number, y: number) => !taken.some((box) => overlaps({ x, y, ...size }, box))
  if (free(origin.x, origin.y)) return origin
  const step = 24
  for (let ring = 1; ring < 60; ring++) {
    const spots: { x: number; y: number; d: number }[] = []
    for (let i = -ring; i <= ring; i++)
      for (const [dx, dy] of [
        [i, -ring],
        [i, ring],
        [-ring, i],
        [ring, i],
      ] as const) {
        const x = origin.x + dx * step
        const y = origin.y + dy * step
        spots.push({ x, y, d: Math.hypot(x - origin.x, y - origin.y) })
      }
    const best = spots.sort((a, b) => a.d - b.d).find((spot) => free(spot.x, spot.y))
    if (best) return { x: best.x, y: best.y }
  }
  return origin
}

export function contentBounds(space: SpaceDocument): Box | null {
  const boxes = Object.values(space.elements)
  return boxes.length === 0 ? null : boundsOfBoxes(boxes)
}

/**
 * The first free position for a box of `size`: inside `within` (a frame), beside `near` (the
 * element it relates to), else in a column right of everything on the board. "Free" means it
 * overlaps nothing but the frame it is placed in.
 */
export function placeFree(
  space: SpaceDocument,
  size: { w: number; h: number },
  options: { within?: string; near?: string } = {},
): { x: number; y: number } {
  const frame = options.within ? space.elements[options.within] : undefined
  const others = Object.entries(space.elements)
    .filter(([id]) => id !== options.within)
    .map(([, element]) => element)
  const free = (x: number, y: number) =>
    !others.some((other) => overlaps({ x, y, ...size }, other)) &&
    (!frame || contains(frame, { x, y, ...size }))

  if (frame) {
    for (let y = frame.y + INSET * 2; y + size.h <= frame.y + frame.h; y += INSET)
      for (let x = frame.x + INSET; x + size.w <= frame.x + frame.w; x += INSET)
        if (free(x, y)) return { x, y }
    return { x: frame.x + INSET, y: frame.y + INSET * 2 }
  }

  const anchor = options.near ? space.elements[options.near] : undefined
  if (anchor) {
    const beside = [
      { x: anchor.x + anchor.w + GAP, y: anchor.y },
      { x: anchor.x, y: anchor.y + anchor.h + GAP },
      { x: anchor.x - size.w - GAP, y: anchor.y },
      { x: anchor.x, y: anchor.y - size.h - GAP },
    ]
    const spot = beside.find((candidate) => free(candidate.x, candidate.y))
    if (spot) return spot
  }

  const bounds = contentBounds(space)
  if (!bounds) return { x: 0, y: 0 }
  const x = (anchor ? anchor.x + anchor.w : bounds.x + bounds.w) + GAP * 2
  for (let y = anchor?.y ?? bounds.y; ; y += GAP) if (free(x, y)) return { x, y }
}
