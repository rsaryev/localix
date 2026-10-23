import { useCallback, useState } from 'react'
import { useZoomBelow } from '@localixai/kit/canvas'

/**
 * Past this many elements a board draws only what is in view: at 1,500 elements every pan
 * repainted them all and the camera fell to about 24 frames a second, while a person reads only
 * what is on screen. Smaller boards draw everything, as they always did.
 */
export const RENDER_WINDOW_FROM = 300

/**
 * Below this zoom most of a large board is in view anyway, and choosing what to draw on every
 * frame of a pan costs more than drawing it: windowing then slowed a 1,500-element pan from 42 ms
 * a frame to 57. Closer in, it took the same pan from 42 ms to 10.
 */
const WINDOW_FROM_ZOOM = 0.5

/**
 * Whether the board draws only the elements in view, and the way to draw ALL of them for a moment
 * — a copy of the board as an image is cloned from what is drawn, so it asks for the whole board
 * first and lets go when the copy is taken.
 */
export function useRenderWindow(count: number) {
  const [whole, setWhole] = useState(false)
  const far = useZoomBelow(WINDOW_FROM_ZOOM)
  const drawAll = useCallback(
    () =>
      new Promise<() => void>((resolve) => {
        setWhole(true)
        // Two frames: one for React to commit the nodes, one for them to lay out.
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(() => setWhole(false))))
      }),
    [],
  )
  return { windowed: count > RENDER_WINDOW_FROM && !far && !whole, drawAll }
}
