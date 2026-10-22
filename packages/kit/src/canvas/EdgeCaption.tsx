import { useLayoutEffect, useRef, useState, type PointerEvent, type RefObject } from 'react'
import { EdgeLabelRenderer, useReactFlow } from '@xyflow/react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { LABEL_GAP, labelAnchor, nearestT, type LabelAnchor, type PathProbe } from './edge-label'

/**
 * A caption a person wrote on an edge (`edge-label.ts` says where it goes and why).
 *
 * It is painted on the opaque popover ground, so the board under it never shows through, and its
 * layer sits above the nodes (`canvas.css`): a caption half under a card read as a fragment. With
 * `onMove`, it slides along its line under the pointer and reports where it was let go.
 */
const probeOf = (path: SVGPathElement | null): PathProbe | null => {
  if (!path || typeof path.getTotalLength !== 'function') return null
  const length = path.getTotalLength()
  if (!Number.isFinite(length) || length <= 0) return null
  return { length, pointAt: (distance) => path.getPointAtLength(distance) }
}

export function EdgeCaption({
  path,
  d,
  label,
  at = 0.5,
  fallback,
  emphasis,
  onMove,
  onSelect,
}: {
  /** The drawn line, measured for where the caption goes. */
  path: RefObject<SVGPathElement | null>
  /** The line's geometry: the caption is placed again whenever it changes. */
  d: string
  label: string
  /** 0…1 along the line. */
  at?: number
  /** The library's midpoint, used where the line cannot be measured. */
  fallback: { x: number; y: number }
  emphasis: string
  onMove?: (at: number) => void
  /** A press on the caption that did not drag it: the caption stands for its line. */
  onSelect?: () => void
}) {
  const { screenToFlowPosition } = useReactFlow()
  const [dragging, setDragging] = useState<number | null>(null)
  /** Where the press began, and whether the pointer has since travelled far enough to drag. */
  const press = useRef({ x: 0, y: 0, moved: false })
  const [anchor, setAnchor] = useState<LabelAnchor>({ ...fallback, across: true })
  const t = dragging ?? at
  const latest = useRef(fallback)
  latest.current = fallback

  useLayoutEffect(() => {
    const probe = probeOf(path.current)
    setAnchor(probe ? labelAnchor(probe, t) : { ...latest.current, across: true })
  }, [path, d, t])

  const follow = (event: PointerEvent<HTMLDivElement>) => {
    const probe = probeOf(path.current)
    if (!probe) return
    const travel = Math.hypot(event.clientX - press.current.x, event.clientY - press.current.y)
    // The few pixels a click wanders are still a click, not a move.
    if (!press.current.moved && travel < 4) return
    press.current.moved = true
    setDragging(nearestT(probe, screenToFlowPosition({ x: event.clientX, y: event.clientY })))
  }

  // Beside the stroke, never on it: above a run across, to the right of a run down.
  const offset = anchor.across
    ? `translate(-50%, calc(-100% - ${LABEL_GAP}px))`
    : `translate(${LABEL_GAP + 2}px, -50%)`
  return (
    <EdgeLabelRenderer>
      <div
        data-canvas-edge-label=""
        data-emphasis={emphasis}
        style={{ transform: `translate(${anchor.x}px, ${anchor.y}px) ${offset}` }}
        className={cn(
          'absolute max-w-56 truncate rounded-md border border-border-soft bg-background-solid px-1.5 py-0.5 text-2xs text-text-soft shadow-(--shadow-soft)',
          onMove
            ? 'nodrag nopan pointer-events-auto cursor-grab'
            : onSelect
              ? 'nodrag nopan pointer-events-auto cursor-pointer'
              : 'pointer-events-none',
          dragging !== null && 'cursor-grabbing',
          // The caption of the selected line is marked with it.
          emphasis === 'focus' && 'border-status-info/60 text-foreground',
        )}
        title={onMove ? 'Drag along the line to move' : undefined}
        onPointerDown={
          onMove || onSelect
            ? (event) => {
                if (event.button !== 0) return
                event.stopPropagation()
                event.currentTarget.setPointerCapture(event.pointerId)
                press.current = { x: event.clientX, y: event.clientY, moved: false }
                setDragging(t)
              }
            : undefined
        }
        onPointerMove={dragging !== null && onMove ? follow : undefined}
        onPointerUp={
          onMove || onSelect
            ? (event) => {
                if (dragging === null) return
                event.currentTarget.releasePointerCapture(event.pointerId)
                if (press.current.moved && Math.abs(dragging - at) > 0.005) onMove?.(dragging)
                else onSelect?.()
                setDragging(null)
              }
            : undefined
        }
      >
        {label}
      </div>
    </EdgeLabelRenderer>
  )
}
