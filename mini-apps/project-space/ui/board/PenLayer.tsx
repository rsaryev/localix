import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { ViewportPortal, useCanvasCamera } from '@localixai/kit/canvas'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { SpaceDocument } from '../../shared/format/document'
import { newId, takenIn } from '../../shared/format/ids'
import type { SpaceOp } from '../../shared/ops/contract'
import { penElement, PEN_POINTS, strokesHit, type PenPoint } from '../../shared/types/pen'
import { placementOf } from './placement'
import { PlacementPreview } from './PlacementGhost'

/**
 * Capture a stroke above the canvas, but beneath the toolbars. No writes until pointer-up. With
 * the eraser, the path draws nothing: the strokes it passes over fade as it goes and are deleted,
 * in one write and one undo step, when the pointer lifts.
 */
const ERASER_RADIUS = 6

/** What a new stroke is drawn with: a highlighter left at the pen's colour takes marker yellow. */
const strokeProps = (toolProps?: Record<string, unknown>) =>
  toolProps?.kind === 'highlighter' && !toolProps.color
    ? { ...toolProps, color: 'yellow' }
    : { ...toolProps }
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
  const erasing = toolProps?.kind === 'eraser'
  const [doomed, setDoomed] = useState<ReadonlySet<string>>(new Set())
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
    if (erasing) {
      const radius = ERASER_RADIUS / camera.get().zoom
      const hit = strokesHit(Object.entries(space.elements), [at], radius)
      if (hit.some((id) => !doomed.has(id))) setDoomed((now) => new Set([...now, ...hit]))
    }
  }
  const clear = () => {
    pointer.current = null
    draft.current = []
    setPoints([])
    setDoomed(new Set())
  }
  const focusBoard = (element: HTMLElement) =>
    element.parentElement
      ?.querySelector<HTMLElement>('.localix-canvas')
      ?.focus({ preventScroll: true })
  const element = points.length && !erasing ? penElement(points) : null
  const recipe = element ? placementOf(type, { ...strokeProps(toolProps), ...element.props }) : null
  const preview = recipe && element ? { ...recipe, size: { w: element.w, h: element.h } } : null
  return (
    <>
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- `role="application"` is the interactive widget role the rule does not know: the pen surface owns its pointer and keys */}
      <div
        ref={root}
        className="absolute inset-0 z-(--z-raised) cursor-crosshair touch-none outline-none"
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the surface is one focus stop, taken when the pen is chosen
        tabIndex={0}
        role="application"
        aria-label={
          erasing
            ? 'Eraser: drag over strokes to erase them, Escape to cancel'
            : 'Pen: drag to draw, Escape to cancel'
        }
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
          if (erasing) {
            if (doomed.size) commit([...doomed].map((id) => ({ op: 'delete' as const, id })))
          } else {
            const stroke = penElement(draft.current)
            const id = newId(takenIn(space))
            // What the preview drew is what is saved: the remembered look, the tool's, the stroke's.
            const asked = { ...strokeProps(toolProps), ...stroke.props }
            const props = placementOf(type, asked)?.props ?? asked
            commit([{ op: 'create', type, id, ...stroke, props }])
            select([id])
          }
          clear()
          focusBoard(event.currentTarget)
          finish()
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId)
        }}
        onPointerCancel={clear}
        onLostPointerCapture={clear}
      />
      {erasing && doomed.size > 0 && (
        // The strokes about to go, dimmed in place: a style rule over their nodes, no copy of them.
        <style>
          {[...doomed].map((id) => `.react-flow__node[data-id="${CSS.escape(id)}"]`).join(',') +
            '{opacity:.25}'}
        </style>
      )}
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
        {erasing ? 'Drag over strokes to erase · Esc to cancel' : 'Drag to draw · Esc to cancel'}
      </span>
    </>
  )
}
