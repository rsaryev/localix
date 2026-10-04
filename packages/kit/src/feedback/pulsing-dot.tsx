import { cn } from '@localixai/plugin-sdk/ui/classes'

/**
 * Small "live activity" dot that breathes via the `reasoning-pulse` keyframe —
 * the working/streaming indicator used across the composer status strip, the
 * reply reel, stacked tool groups, etc. One primitive so the size + animation
 * stay identical everywhere. Inherits color from `currentColor` (set via a text
 * color on the parent or `className`).
 */
export function PulsingDot({
  animate = true,
  className,
}: {
  animate?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'size-[0.35rem] shrink-0 rounded-full bg-current motion-reduce:animate-none',
        className,
      )}
      style={
        animate ? { animation: 'reasoning-pulse 1.2s var(--ease-standard) infinite' } : undefined
      }
    />
  )
}
