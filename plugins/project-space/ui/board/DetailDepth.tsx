import { useLayoutEffect, type RefObject } from 'react'
import { useZoomBelow } from '@localixai/kit/canvas'

/**
 * How much of the board's small print is drawn, by how close the camera is — as `data-depth` on
 * the board's root, for `reading.css`.
 *
 * Zoomed out, a connector's label and a card's footer are a few pixels tall: they no longer read,
 * they only add noise to the shapes that still do. So the board keeps three reading depths:
 * MAP from afar shows the shapes and their titles, READ adds connector labels, and
 * FULL, near 100 %, adds each card's fine print (`data-detail="fine"`: a file's line count, a
 * folder's entry count). What is selected or lit by a trace keeps its detail at any depth — the
 * person is looking at exactly that.
 *
 * The depth changes when the camera RESTS on the other side of a threshold (`useZoomBelow`), not
 * on the frame it crosses: a flight across the board would otherwise restyle every card mid-way.
 */
export const MAP_BELOW = 0.5
export const READ_BELOW = 0.9

export type Depth = 'map' | 'read' | 'full'

export function depthAt(zoom: number): Depth {
  return zoom < MAP_BELOW ? 'map' : zoom < READ_BELOW ? 'read' : 'full'
}

export function DetailDepth({ target }: { target: RefObject<HTMLElement | null> }) {
  const map = useZoomBelow(MAP_BELOW)
  const read = useZoomBelow(READ_BELOW)
  const depth: Depth = map ? 'map' : read ? 'read' : 'full'
  useLayoutEffect(() => {
    target.current?.setAttribute('data-depth', depth)
  }, [depth, target])
  return null
}
