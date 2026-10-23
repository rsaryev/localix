import { memo, useEffect, useMemo, useState, type RefObject } from 'react'
import { useCanvasCamera, ViewportPortal } from '@localixai/kit/canvas'
import { cn } from '@localixai/mini-app-sdk/ui/classes'
import { FLOATING_SURFACE } from '@localixai/kit/workbench-toolbar'
import { ELEMENT_CARD } from '../elements/surface'
import { placementOf } from './placement'

const ignore = () => undefined

/** The actual element view, without editing, selection, handles, or pointer interaction. */
export const PlacementPreview = memo(function PlacementPreview({
  placement,
}: {
  placement: NonNullable<ReturnType<typeof placementOf>>
}) {
  const { view, props, size } = placement
  return (
    <div
      className={cn('space-ghost-content h-full w-full', view.chrome === 'card' && ELEMENT_CARD)}
    >
      <view.View
        id="placement-preview"
        props={props}
        width={size.w}
        height={size.h}
        selected={false}
        editing={false}
        missing={false}
        sessionId=""
        stamp={0}
        commit={ignore}
        resize={ignore}
        stopEditing={ignore}
      />
    </div>
  )
})

/**
 * What an armed tool will place, under the pointer, before the click.
 * Armed with only a crosshair, the board gave no sign that a click was all it
 * waited for — a person who picked "code" looked for a dialog. The ghost is the element's real
 * size, props and place (the recipe `useTools.placeAt` uses), in board coordinates. Its real
 * view is muted; the small caption below it explains click to place and Escape to cancel.
 *
 * It follows the pointer through its own state, so moving the pointer re-renders this and not
 * the board; it hides over the tool rail and the floating bars (`nodrag`), where a click does
 * not place.
 */
export function PlacementGhost({
  root,
  tool,
  toolProps,
}: {
  root: RefObject<HTMLElement | null>
  tool: string
  toolProps?: Record<string, unknown>
}) {
  const camera = useCanvasCamera()
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const placement = useMemo(() => placementOf(tool, toolProps), [tool, toolProps])

  useEffect(() => {
    const element = root.current
    if (!element) return
    const move = (event: PointerEvent) => {
      const target = event.target as Element | null
      const onBoard =
        target?.closest('.react-flow__pane, .react-flow__node') && !target.closest('.nodrag')
      setAt(onBoard ? camera.toBoard(event.clientX, event.clientY) : null)
    }
    const leave = () => setAt(null)
    element.addEventListener('pointermove', move)
    element.addEventListener('pointerleave', leave)
    return () => {
      element.removeEventListener('pointermove', move)
      element.removeEventListener('pointerleave', leave)
    }
  }, [camera, root])

  if (!at || !placement) return null
  const { w, h } = placement.size
  return (
    <ViewportPortal>
      <div
        aria-hidden
        inert
        className="space-ghost"
        style={{
          left: Math.round(at.x - w / 2),
          top: Math.round(at.y - h / 2),
          width: w,
          height: h,
        }}
      >
        <PlacementPreview placement={placement} />
        <span className={cn(FLOATING_SURFACE, 'space-ghost-hint rounded-md border')}>
          Click to place {placement.spec.label.toLowerCase()} · Esc to cancel
        </span>
      </div>
    </ViewportPortal>
  )
}
