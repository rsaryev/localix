import { cn } from '@localixai/mini-app-sdk/ui/classes'

export type LocalixBeamIntensity = 0 | 1 | 2 | 3 | 4 | 5

/**
 * "The next step is suggested" — one intensity for every carrier of the mark (a `Button`, a menu
 * row), so a recommended trigger and the recommended row in the menu it opens read as one cue.
 * Above a waiting state (1), well below a running agent (4), without the glow step 3 adds.
 */
export const RECOMMENDED_BEAM_INTENSITY: LocalixBeamIntensity = 2

/**
 * Decorative, pointer-transparent perimeter beam. The wrapped surface owns its
 * ordinary border; this primitive only adds the transient Localix accent pass.
 * Intensity is deliberately domain-neutral so focus, generation and reasoning
 * controls can share the same effect without this primitive knowing their state.
 */
export function LocalixBorderBeam({
  active,
  variant = 'focus',
  intensity = 0,
  surface = 'ground',
  still = false,
  className,
}: {
  active: boolean
  variant?: 'focus' | 'working'
  intensity?: LocalixBeamIntensity
  /**
   * What the beam travels around. `fill`: a control painted with a solid fill (a `mono` or
   * primary button). The ground beam's brightest stop is `--foreground` on a 1px rim touching the
   * edge, which on a `mono` fill (itself `--foreground`) only made the button 1px larger — the
   * plan's recommended Approve showed no accent at all. A filled beam leads with the accent and
   * stands off the edge (`effects.css`).
   */
  surface?: 'ground' | 'fill'
  /** Shown but not travelling (reduced motion pauses it too). The turn itself is a compositor
   *  rotation (`effects.css`), so travelling is cheap; `still` is for a beam that should not move. */
  still?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden="true"
      data-active={active}
      data-still={still ? 'true' : undefined}
      data-variant={variant}
      data-intensity={intensity}
      data-surface={surface === 'fill' ? 'fill' : undefined}
      className={cn('lx-border-beam', className)}
    >
      {/* Two static ring masks, each clipping its own spinning gradient layer (`effects.css`). */}
      <span className="lx-beam-ring" />
      <span className="lx-beam-glow" />
    </span>
  )
}
