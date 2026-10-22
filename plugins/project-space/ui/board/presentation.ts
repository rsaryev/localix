import type { SpaceDocument } from '../../shared/format/document'
import { frameOf } from '../../shared/ops/geometry'
import { readingOrder } from '../../shared/ops/layout'
import { spaceTypes } from '../../shared/types'

/**
 * The slides of a board: its frames in reading order, top to bottom and left to right, the way a
 * person laid out the story. A frame inside another frame is part of its slide, not one of its
 * own, as the whiteboards present only outer frames.
 */
export function presentationFrames(space: SpaceDocument): string[] {
  return Object.entries(space.elements)
    .filter(([id, element]) => element.type === 'frame' && !frameOf(space, id, spaceTypes))
    .sort(([, a], [, b]) => readingOrder(a, b))
    .map(([id]) => id)
}
