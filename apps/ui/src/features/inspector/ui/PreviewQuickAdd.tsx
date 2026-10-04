import { MessageSquarePlus } from 'lucide-react'
import type { VfRect } from '@localixai/visual-feedback/protocol'
import { Button } from '@localixai/kit/button'

const BTN_HEIGHT = 28
const BTN_WIDTH = 116

/**
 * Attach captured text and source context from the preview.
 * the lightweight counterpart to {@link PreviewComposer} (which owns the full
 * note + screenshot flow for element picks). Anchored just above the selected
 * range (flips below when there's no room) and clamped inside the preview body.
 *
 * Fires on `mousedown` (not click): the probe has already captured the selection
 * text, and acting on mousedown drops it into the composer before a stray click /
 * blur can dismiss the button.
 */
export function PreviewQuickAdd({
  rect,
  bodySize,
  onAdd,
}: {
  rect: VfRect
  bodySize: { w: number; h: number }
  onAdd: () => void
}) {
  const above = rect.y - BTN_HEIGHT - 6
  const below = rect.y + rect.height + 6
  const top = above >= 6 ? above : Math.min(below, Math.max(6, bodySize.h - BTN_HEIGHT - 6))
  const left = Math.min(Math.max(6, rect.x), Math.max(6, bodySize.w - BTN_WIDTH - 6))

  return (
    <Button
      type="button"
      // mousedown so the selection lands in the composer before any click/blur dismisses us.
      onMouseDown={(e) => {
        if (e.button !== 0) return
        e.preventDefault()
        onAdd()
      }}
      // Keyboard and assistive activation generate click without a pointer press.
      onClick={(e) => {
        if (e.detail === 0) onAdd()
      }}
      variant="outline"
      size="default"
      // Floating-toolbar recipe (alpha + frost), not a bare `bg-surface-raised`: raised mixes
      // from a darker ground than the preview it floats over, so the pill read as a black lozenge.
      className="pointer-events-auto absolute z-(--z-controls) w-[116px] rounded-full border-control-border bg-surface-raised/90 text-text-soft shadow-(--shadow-popover) backdrop-blur hover:bg-surface-hover hover:text-foreground"
      style={{ left, top }}
    >
      <MessageSquarePlus className="size-3.5" />
      Attach context
    </Button>
  )
}
