import { cn } from '@localixai/plugin-sdk/ui/classes'
import { DROP_TARGET_OVERLAY_ACTIVE, DROP_TARGET_TRANSITION } from '@localixai/kit/drop-target'
import type { DropZone } from '../model/dropZone'

/** Translucent highlight showing where a dragged tab will land: the whole group
 *  (center = move/append) or a half (edge = split a new group there). */
export function SplitOverlay({ zone }: { zone: DropZone }) {
  const place =
    zone === 'center'
      ? 'inset-0'
      : zone === 'left'
        ? 'left-0 top-0 bottom-0 w-1/2'
        : zone === 'right'
          ? 'right-0 top-0 bottom-0 w-1/2'
          : zone === 'up'
            ? 'top-0 inset-x-0 h-1/2'
            : 'bottom-0 inset-x-0 h-1/2'
  return (
    <div className="pointer-events-none absolute inset-0 z-(--z-overlay)">
      {/* Animate ONLY opacity/colour — never geometry. A transition-all here made
          the highlight visibly slide its position/size when the zone changed,
          reading as lag; the box should snap to the new zone and only fade in. */}
      <div
        className={cn(
          'absolute motion-safe:animate-in motion-safe:fade-in',
          DROP_TARGET_TRANSITION,
          DROP_TARGET_OVERLAY_ACTIVE,
          place,
        )}
      />
    </div>
  )
}
