import { forwardRef, type ComponentPropsWithoutRef, type ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/**
 * The one treatment for icon actions floating OVER media — lightbox corners,
 * inline media figures, attachment thumbnails, lightbox controls.
 *
 * The black/white palette here is intentionally NON-token: these controls sit
 * on photographic/video pixels, not on the theme, so a translucent black scrim
 * with white glyphs and a faint white ring is the only material that stays
 * legible on any image in both light and dark themes. Do not "fix" it to
 * surface tokens.
 */
const MEDIA_OVERLAY_BASE =
  'inline-flex shrink-0 items-center justify-center bg-black/55 text-white ring-1 ring-white/20 backdrop-blur-sm transition-colors focus-ring'

/** Same measure ladder as IconButton/Button, via the chrome-control tokens. */
const MEDIA_OVERLAY_SIZE = {
  /** 20px — tiny thumbnail affordances (attachment remove ✕). */
  xs: 'size-[var(--chrome-control-xs)]',
  /** 24px — dense hover rows. */
  sm: 'size-[var(--chrome-control-sm)]',
  /** 28px — default in-content action rows. */
  md: 'size-[var(--chrome-control-md)]',
  /** 32px — lightbox corner actions. */
  lg: 'size-[var(--chrome-control-lg)]',
  /** 36px — primary media affordances (lightbox paging, play badge). */
  xl: 'size-[var(--chrome-control-xl)]',
} as const

const MEDIA_OVERLAY_SHAPE = {
  round: 'rounded-full',
  square: 'rounded-md',
} as const

interface MediaOverlayStyleOptions {
  size?: keyof typeof MEDIA_OVERLAY_SIZE
  shape?: keyof typeof MEDIA_OVERLAY_SHAPE
  /** Hover warns of a destructive action (delete) instead of the plain darken. */
  destructive?: boolean
  className?: string
}

/**
 * Class-only variant for non-button hosts (download `<a>`, decorative play
 * badge) so every over-media chip shares one material.
 */
function mediaOverlayClasses({
  size = 'md',
  shape = 'round',
  destructive = false,
  className,
}: MediaOverlayStyleOptions = {}) {
  return cn(
    MEDIA_OVERLAY_BASE,
    MEDIA_OVERLAY_SIZE[size],
    MEDIA_OVERLAY_SHAPE[shape],
    destructive ? 'hover:bg-destructive/85' : 'hover:bg-black/75',
    className,
  )
}

/**
 * The same material as a labelled pill — an icon plus text (the lightbox's Copy / Download row).
 * It used to be a hand-copied string beside the lightbox with a heavier blur and no focus
 * indicator, so the two over-media treatments in one viewer disagreed and the pills were the only
 * controls there a keyboard user could not see land on.
 */
function mediaOverlayPillClasses(className?: string) {
  return cn(
    MEDIA_OVERLAY_BASE,
    'gap-1.5 rounded-md px-3 py-1.5 text-xs hover:bg-black/75',
    className,
  )
}

type MediaOverlayButtonProps = Omit<ComponentPropsWithoutRef<'button'>, 'aria-label'> &
  MediaOverlayStyleOptions & {
    /** Icon-only controls always need a stable accessible name. */
    'aria-label': string
    children: ReactNode
  }

const MediaOverlayButton = forwardRef<HTMLButtonElement, MediaOverlayButtonProps>(
  ({ className, type = 'button', size = 'md', shape = 'round', destructive, ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      data-slot="media-overlay-button"
      className={mediaOverlayClasses({ size, shape, destructive, className })}
      {...props}
    />
  ),
)
MediaOverlayButton.displayName = 'MediaOverlayButton'

export { MediaOverlayButton, mediaOverlayClasses, mediaOverlayPillClasses }
export type { MediaOverlayButtonProps }
