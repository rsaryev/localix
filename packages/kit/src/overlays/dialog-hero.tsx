import type { CSSProperties, ReactNode } from 'react'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** What the mark is about: the theme's accent, something that cannot be undone, or neither. */
export type DialogHeroTone = 'accent' | 'danger' | 'neutral'

// Where each spark starts across the stage, its delay and how long it rises: fixed, so the stage
// is the same on every open and in every capture.
const SPARKS = [
  [14, 0, 5.2],
  [27, 1.8, 4.6],
  [38, 0.9, 5.8],
  [62, 2.6, 5],
  [71, 0.4, 4.4],
  [84, 1.4, 5.6],
] as const

/**
 * The animated mark a dialog opens with, so every dialog arrives the same way: the icon tile
 * rises, a ring draws around it in the tone's colour, a glow settles behind it, and a halo breathes
 * out. `sm` heads a dialog's header (every ConfirmDialog has one); `lg` is a stage above the header
 * for an announcement, with rising sparks and `children` under the tile (a version, a name).
 *
 * Decoration only: hidden from assistive technology, and drawn in its finished state when the
 * person prefers reduced motion. A short window hides the `lg` stage first.
 */
export function DialogHero({
  icon,
  tone = 'accent',
  size = 'sm',
  badge,
  children,
  className,
}: {
  icon: ReactNode
  tone?: DialogHeroTone
  size?: 'sm' | 'lg'
  /** A small round mark that lands on the tile's corner once the ring closes. */
  badge?: ReactNode
  /** `lg` only: what stands under the tile. */
  children?: ReactNode
  className?: string
}) {
  const large = size === 'lg'
  return (
    <div
      aria-hidden
      data-slot="dialog-hero"
      data-size={size}
      data-tone={tone}
      className={cn('lx-dialog-hero', className)}
    >
      <span className="lx-hero-glow" />
      {large
        ? SPARKS.map(([left, delay, duration], i) => (
            <span
              key={i}
              className="lx-hero-spark"
              style={
                { '--x': `${left}%`, '--d': `${delay}s`, '--t': `${duration}s` } as CSSProperties
              }
            />
          ))
        : null}
      <span className="lx-hero-mark">
        <span className="lx-hero-halo" />
        <svg className="lx-hero-ring" viewBox="0 0 100 100">
          <circle className="lx-hero-ring-track" cx="50" cy="50" r="46" pathLength={1} />
          <circle className="lx-hero-ring-fill" cx="50" cy="50" r="46" pathLength={1} />
        </svg>
        <span className="lx-hero-tile">{icon}</span>
        {badge ? <span className="lx-hero-badge">{badge}</span> : null}
      </span>
      {large ? children : null}
    </div>
  )
}
