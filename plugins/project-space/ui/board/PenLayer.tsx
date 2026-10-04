import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ViewportPortal, useCanvasCamera } from '@localixai/kit/canvas'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import type { SpaceDocument } from '../../shared/format/document'
import { newId, takenIn } from '../../shared/format/ids'
import type { SpaceOp } from '../../shared/ops/contract'
import { penElement, PEN_POINTS, type PenPoint } from '../../shared/types/pen'
import { placementOf } from './placement'
import { PlacementPreview } from './PlacementGhost'

/** Capture a stroke above the canvas, but beneath the toolbars. No writes until pointer-up. */
export function PenLayer({
  type,
  toolProps,
  space,
  commit,
  select,
  finish,
  cancel,
  onBoardKey,
}: {
  type: string
  toolProps?: Record<string, unknown>
  space: SpaceDocument
  commit: (ops: readonly SpaceOp[]) => void
  select: (ids: Iterable<string>) => void
  finish: () => void
  cancel: () => void
  onBoardKey: (event: KeyboardEvent<HTMLDivElement>) => boolean
}) {
  const camera = useCanvasCamera()
  const root = useRef<HTMLDivElement>(null)
  const pointer = useRef<number | null>(null)
  const draft = useRef<PenPoint[]>([])
  const [points, setPoints] = useState<PenPoint[]>([])
  // The rail owns focus when the tool is armed. Move it to the drawing layer so Q and Escape
  // work before the first stroke, then return it to the canvas when drawing ends.
  useEffect(() => root.current?.focus({ preventScroll: true }), [])
  const add = (event: PointerEvent<HTMLDivElement>, force = false) => {
    const at = camera.toBoard(event.clientX, event.clientY)
    const last = draft.current.at(-1)
    if (
      draft.current.length >= PEN_POINTS ||
      (!force && last && Math.hypot(at.x - last.x, at.y - last.y) < 0.8)
    )
      return
    draft.current.push(at)
    setPoints([...draft.current])
  }
  const clear = () => {
    pointer.current = null
    draft.current = []
    setPoints([])
  }
  const focusBoard = (element: HTMLElement) =>
    element.parentElement
      ?.querySelector<HTMLElement>('.localix-canvas')
      ?.focus({ preventScroll: true })
  const element = points.length ? penElement(points) : null
  const recipe = element ? placementOf(type, { ...toolProps, ...element.props }) : null
  const preview = recipe && element ? { ...recipe, size: { w: element.w, h: element.h } } : null
  return (
    <>
      <div
        ref={root}
        className="absolute inset-0 z-(--z-raised) cursor-crosshair touch-none outline-none"
        tabIndex={0}
        role="application"
        aria-label="Pen: drag to draw, Escape to cancel"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            clear()
            focusBoard(event.currentTarget)
            cancel()
          } else if (pointer.current === null && onBoardKey(event)) event.preventDefault()
        }}
        onPointerDown={(event) => {
          if (event.button !== 0 || pointer.current !== null) return
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus({ preventScroll: true })
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = event.pointerId
          draft.current = []
          add(event, true)
        }}
        onPointerMove={(event) => {
          if (pointer.current === event.pointerId) {
            event.stopPropagation()
            add(event)
          }
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return
          event.preventDefault()
          event.stopPropagation()
          add(event)
          const stroke = penElement(draft.current)
          const id = newId(takenIn(space))
          commit([{ op: 'create', type, id, ...stroke, props: { ...toolProps, ...stroke.props } }])
          select([id])
          clear()
          focusBoard(event.currentTarget)
          finish()
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={clear}
        onLostPointerCapture={clear}
      />
      {element && preview && (
        <ViewportPortal>
          <div
            aria-hidden
            inert
            className="pointer-events-none absolute z-(--z-raised) space-pen-live"
            style={{ left: element.x, top: element.y, width: element.w, height: element.h }}
          >
            <PlacementPreview placement={preview} />
          </div>
        </ViewportPortal>
      )}
      <span
        aria-hidden
        className={cn(
          FLOATING_SURFACE,
          'pointer-events-none absolute bottom-3 left-1/2 z-(--z-raised) -translate-x-1/2 rounded-md border px-2 py-1 text-2xs text-text-soft',
        )}
      >
        Drag to draw · Esc to cancel
      </span>
    </>
  )
}
