import { MiniMap } from '@xyflow/react'

/**
 * The overview inset, above the camera controls, in the host's surface. Its colours are the
 * `--xy-minimap-*` tokens `canvas.css` sets for every board, not per-board props, so two boards'
 * overviews cannot drift apart.
 */
export function CanvasMiniMap() {
  return (
    <MiniMap
      pannable
      zoomable
      position="bottom-right"
      ariaLabel="Board overview"
      className="!bottom-12 !right-1 !m-2 !h-24 !w-36 overflow-hidden !rounded-md !border !border-border-soft !shadow-(--shadow-popover)"
    />
  )
}
