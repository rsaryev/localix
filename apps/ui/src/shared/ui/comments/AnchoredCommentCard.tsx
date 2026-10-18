import { useEffect, useRef, useState, type ComponentProps } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { POPOVER_SURFACE, POPOVER_SURFACE_OVER_FOREIGN } from '@localixai/kit/popover-surface'
import { CommentDraftCard } from './CommentDraftCard'

/** A target's box in the container's coordinates. A caret or a text run is a zero-size box. */
export interface CommentAnchorRect {
  x: number
  y: number
  width?: number
  height?: number
}

const EDGE = 8

/**
 * Where a comment is written, on any surface: one card, anchored to the thing being commented
 * on, inside the surface that holds it.
 *
 * The form itself is {@link CommentDraftCard}; what this adds is the part each surface had been
 * solving on its own — placing the card near its target without covering it or leaving the pane,
 * and picking the material for the ground it floats over. Two implementations of that drifted
 * into two different behaviours: the preview flipped above the element when there was no room
 * below, the plan's card did not and could sit off the bottom of a long page.
 *
 * `material` is the one thing a caller must think about. Over the app's own chrome the standard
 * frosted panel is right; over a live preview of someone else's page it is not — that surface
 * frosts whatever happens to be behind it, and 82% white above a beige game board is a card you
 * cannot read.
 */
export function AnchoredCommentCard({
  anchor,
  bounds,
  align = 'start',
  material = 'app',
  width = 288,
  active = true,
  className,
  ...card
}: {
  anchor: CommentAnchorRect
  /** The container the card must stay inside. */
  bounds: { width: number; height: number }
  /** `center` hangs the card under the anchor's midpoint (a text selection); `start` aligns left. */
  align?: 'start' | 'center'
  /** `foreign` = floating over content the app does not own, so the panel goes opaque. */
  material?: 'app' | 'foreign'
  width?: number
  /** False while the surface is mounted but hidden — stop measuring. */
  active?: boolean
  className?: string
} & Omit<ComponentProps<typeof CommentDraftCard>, 'className' | 'style'>) {
  const ref = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(0)

  // Measured, not guessed: the flip below needs the card's real height, which depends on the
  // subject, the note and whatever the surface put in the slot.
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setHeight(el.offsetHeight))
    ro.observe(el)
    setHeight(el.offsetHeight)
    return () => ro.disconnect()
  }, [active])

  const cardWidth = Math.min(width, Math.max(0, bounds.width - 2 * EDGE))
  const centered = align === 'center' || (anchor.width ?? 0) >= bounds.width * 0.8
  const rawLeft = centered ? anchor.x + (anchor.width ?? 0) / 2 - cardWidth / 2 : anchor.x
  const left = Math.min(Math.max(EDGE, rawLeft), Math.max(EDGE, bounds.width - cardWidth - EDGE))
  // A target that fills the pane has no "beside" — commenting on the whole screen put the
  // card at the very bottom, nowhere near the click. There the card belongs in the middle.
  const fillsPane = (anchor.height ?? 0) >= bounds.height * 0.8
  // Otherwise: below the target, flipped above when below would overflow — so the card never
  // covers the thing you are commenting on. Clamped only when neither side fits.
  const below = anchor.y + (anchor.height ?? 0) + EDGE
  const above = anchor.y - height - EDGE
  const top = fillsPane
    ? Math.max(EDGE, (bounds.height - height) / 2)
    : below + height + EDGE <= bounds.height
      ? below
      : above >= EDGE
        ? above
        : Math.min(Math.max(EDGE, below), Math.max(EDGE, bounds.height - height - EDGE))

  return (
    <div
      ref={ref}
      // The overlay recipe's entrance (fade + settle from 95%, `--dur-instant`), for a card that
      // mounts rather than opening through a Radix state.
      className="pointer-events-auto absolute z-(--z-overlay) origin-top animate-in fade-in-0 zoom-in-95 duration-(--dur-instant)"
      style={{ left, top, width: cardWidth }}
    >
      <CommentDraftCard
        {...card}
        className={cn(
          material === 'foreign' ? POPOVER_SURFACE_OVER_FOREIGN : POPOVER_SURFACE,
          'overflow-y-auto p-2 scrollbar-thin',
          className,
        )}
        style={{ maxHeight: Math.max(0, bounds.height - 2 * EDGE) }}
      />
    </div>
  )
}
