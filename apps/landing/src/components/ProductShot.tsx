import { cn } from '../lib/cn'
import { homeShots } from '../generated/home-shots'

/**
 * A product capture at its true 1600×1000 ratio. The box is sized by `width`/`height` before the
 * file arrives, so a slow image never moves the text around it. A key with no capture on disk
 * renders nothing: a missing picture is a gap in the page, not a broken-image icon.
 */
export function ProductShot({
  shot,
  alt,
  priority = false,
  className,
}: {
  shot: string
  alt: string
  /** The picture is the first thing on screen: fetch it now instead of lazily. */
  priority?: boolean
  className?: string
}) {
  const entry = homeShots[shot]
  if (!entry) return null
  return (
    <img
      src={entry.src}
      width={1600}
      height={1000}
      alt={entry.placeholder ? '' : alt}
      aria-hidden={entry.placeholder || undefined}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : undefined}
      className={cn(
        'block aspect-[8/5] h-auto w-full rounded-xl border border-border-subtle bg-card object-cover',
        className,
      )}
    />
  )
}
