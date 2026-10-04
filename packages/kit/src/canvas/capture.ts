import { domToBlob } from 'modern-screenshot'
import type { CanvasRect } from './camera'

/**
 * A rectangle of a board, as a PNG — "copy this as an image", whatever the camera shows.
 *
 * A screenshot of the view would copy the camera instead of the board: a frame half off screen
 * comes out cut, and a zoomed-out board comes out as a smudge. So the board's own layer (the flow
 * library's viewport, which holds the nodes, the edges and their labels) is rendered at 1:1 with
 * the rectangle moved to its origin — the library's documented image export — at up to twice the
 * pixels, capped so a huge board cannot ask the engine for a canvas it refuses to draw.
 *
 * `prepare` lets the board take its hands off the picture — the selection, the handles — and
 * returns the way back. It is undone as soon as the copy has been CLONED (`onCloneNode`), before
 * fonts and images are embedded, so the live board looks different only for that moment.
 *
 * The render is the page's own DOM through an SVG foreignObject (`modern-screenshot`): an image
 * served cross-origin without CORS comes out empty, which a copy states rather than hides.
 */
export interface BoardCaptureOptions {
  /** Clear ground around the rectangle, in board pixels. */
  padding?: number
  /** The longest edge of the PNG, in pixels. */
  maxEdge?: number
  prepare?: () => () => void
}

const MAX_SCALE = 2

export async function captureBoard(
  frame: HTMLElement,
  rect: CanvasRect,
  options: BoardCaptureOptions = {},
): Promise<Blob> {
  const layer = frame.querySelector<HTMLElement>('.react-flow__viewport')
  if (!layer) throw new Error('The board is not drawn yet.')
  const padding = options.padding ?? 32
  const width = Math.ceil(rect.width + padding * 2)
  const height = Math.ceil(rect.height + padding * 2)
  const scale = Math.min(MAX_SCALE, (options.maxEdge ?? 4096) / Math.max(width, height))
  const restore = options.prepare?.()
  let restored = false
  const giveBack = () => {
    if (restored) return
    restored = true
    restore?.()
  }
  try {
    return await domToBlob(layer, {
      type: 'image/png',
      width,
      height,
      scale,
      backgroundColor: groundOf(frame),
      style: {
        width: `${width}px`,
        height: `${height}px`,
        transform: `translate(${padding - rect.x}px, ${padding - rect.y}px) scale(1)`,
      },
      onCloneNode: giveBack,
    })
  } finally {
    giveBack()
  }
}

/** The first opaque background at or above the board: what the picture is drawn on. */
function groundOf(element: HTMLElement): string {
  for (let at: HTMLElement | null = element; at; at = at.parentElement) {
    const colour = getComputedStyle(at).backgroundColor
    if (colour && colour !== 'transparent' && !/rgba\([^)]*,\s*0\)$/u.test(colour)) return colour
  }
  return '#ffffff'
}
