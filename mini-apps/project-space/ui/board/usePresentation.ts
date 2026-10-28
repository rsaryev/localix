import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CameraViewport } from '@localixai/kit/canvas'
import { useCanvasCamera } from '@localixai/kit/canvas'
import type { SpaceDocument } from '../../shared/format/document'
import type { CameraDirector } from '../camera/useCameraDirector'
import { presentViewport } from '../camera/framing'
import { membersOf } from '../../shared/ops/geometry'
import { spaceTypes } from '../../shared/types'
import { presentationFrames } from './presentation'

export interface Presentation {
  active: boolean
  /** What the slide on screen shows: its frame and what the frame holds; null when not presenting. */
  slide: ReadonlySet<string> | null
  /** The slide on screen, 0-based, and how many there are. */
  index: number
  frames: readonly string[]
  /** From the first frame; the board under `root` takes the keyboard, so the arrows walk it. */
  start: (root?: HTMLElement | null, from?: string) => void
  go: (index: number) => void
  stop: () => void
}

/**
 * Presenting the board's frames as slides: the camera flies frame to frame, filling the view,
 * while the board's own chrome steps aside (`space.css`, `[data-presenting]`). Leaving returns the
 * camera to where it was, as if the talk had not moved it. The camera's own history is left alone:
 * a slide is not a trip ⌥← should walk back through.
 */
export function usePresentation(
  space: SpaceDocument,
  director: CameraDirector,
  select: (ids: Iterable<string>) => void,
): Presentation {
  const camera = useCanvasCamera()
  const frames = useMemo(() => presentationFrames(space), [space])
  // The frame on screen, by id: a frame added or removed while presenting (by the agent, say)
  // shifts the positions, and a stored position would then name another slide.
  const [current, setCurrent] = useState<string | null>(null)
  const at = current ? frames.indexOf(current) : -1
  const before = useRef<CameraViewport | null>(null)

  const show = useCallback(
    (index: number) => {
      const id = frames[index]
      const frame = id ? space.elements[id] : undefined
      const size = director.size()
      if (!id || !frame || !size) return
      setCurrent(id)
      void director.glide(presentViewport(frame, size))
    },
    [frames, space, director],
  )

  const slide = useMemo(
    () =>
      at >= 0 && current ? new Set([current, ...membersOf(space, current, spaceTypes)]) : null,
    [at, current, space],
  )
  // The frame on screen was deleted: the talk is over. Dropped in the render itself, so no slide
  // is ever drawn for a frame that is gone.
  if (current && at < 0) setCurrent(null)
  const stop = useCallback(() => setCurrent(null), [])
  // However the talk ended — stopped, or its frame deleted — the board comes back to where it was.
  const active = at >= 0
  const wasActive = useRef(false)
  useEffect(() => {
    if (wasActive.current && !active && before.current) {
      void director.glide(before.current)
      before.current = null
    }
    wasActive.current = active
  }, [active, director])

  return {
    active,
    slide,
    index: Math.max(0, at),
    frames,
    start: (root, from) => {
      if (frames.length === 0) return
      before.current = camera.get()
      select([])
      root?.querySelector<HTMLElement>('[role="application"]')?.focus()
      show(Math.max(0, from ? frames.indexOf(from) : 0))
    },
    go: (index) => show(Math.min(frames.length - 1, Math.max(0, index))),
    stop,
  }
}

/**
 * The board as the slide shows it: only the frame on screen and what it holds, and the lines
 * between them. A slide is its frame — the rest of the board would otherwise peek in at its edges.
 */
export function useSlide<N extends { id: string }, E extends { source: string; target: string }>(
  flow: { nodes: N[]; edges: E[] },
  slide: ReadonlySet<string> | null,
) {
  return useMemo(() => {
    if (!slide) return flow
    return {
      nodes: flow.nodes.map((node) => (slide.has(node.id) ? node : { ...node, hidden: true })),
      edges: flow.edges.map((edge) =>
        slide.has(edge.source) && slide.has(edge.target) ? edge : { ...edge, hidden: true },
      ),
    }
  }, [flow, slide])
}
