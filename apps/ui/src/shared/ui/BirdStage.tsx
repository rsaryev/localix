import { useMemo, type CSSProperties } from 'react'
import type { ResolvedTheme } from '../theme/useTheme'
import { cn } from '@localixai/plugin-sdk/ui/classes'

interface WindLine {
  id: number
  y: number
  width: number
  delay: number
  duration: number
  maxOpacity: number
  thickness: number
}

// Deterministic (index-seeded — no Math.random) so repeat renders stay stable
// and there's no hydration/flicker mismatch.
function buildWindLines(count: number, spread: number): WindLine[] {
  return Array.from({ length: count }, (_, i) => {
    const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1
    const duration = 1.4 + r(1) * 1.8
    return {
      id: i,
      y: (r(2) - 0.5) * spread,
      width: 120 + r(3) * 200,
      delay: -r(4) * duration,
      duration,
      maxOpacity: 0.16 + r(5) * 0.3,
      thickness: 1.2 + r(6) * 2,
    }
  })
}

interface BirdStageProps {
  resolvedTheme?: ResolvedTheme
  /** Stage box sizing classes (defaults to the empty-chat size). */
  stageClassName?: string
  /** Bird image sizing classes. */
  birdClassName?: string
  /** Optional art direction for the wind layer without moving the bird. */
  windClassName?: string
  /** Horizontal origin of each wind line. Defaults outside the compact chat stage. */
  windRight?: string
  /** Multiplier for the generated wind opacity. */
  windIntensity?: number
  lineCount?: number
  /** Vertical spread of the wind lines, in px. */
  spread?: number
  /** Public path used by the monochrome mask. */
  maskUrl?: string
  /**
   * How many times the wind and the bird's drift play before the stage settles still; `Infinity`
   * never settles. The empty chat is the screen the app sits on, and a stage animating forever
   * there (28 moving layers plus the bird) kept the window recomposited every frame for as long
   * as nobody typed: GPU and WindowServer busy on an idle app. Settled, the wind ends invisible
   * (its last keyframe, held) and the bird at rest (its last keyframe is its resting pose).
   */
  cycles?: number
  className?: string
}

/**
 * The Localix bird — the flying-logo hero shared by the empty chat state and the
 * landing hero. Single source of truth so the two never drift. Animations
 * (bird-intro/drift, wind-sweep) come from the shared index.css.
 *
 * The artwork is painted from semantic CSS tokens rather than selected from a
 * light/dark pair. New themes therefore inherit a readable bird automatically,
 * while `--bird-foreground` and `--bird-wind` remain optional art-direction hooks.
 */
export function BirdStage({
  stageClassName = 'size-44',
  birdClassName = 'size-20',
  windClassName,
  windRight = '-40%',
  windIntensity = 1,
  lineCount = 28,
  spread = 220,
  maskUrl = '/logo-dark.svg',
  cycles = 3,
  className,
}: BirdStageProps) {
  const windLines = useMemo(() => buildWindLines(lineCount, spread), [lineCount, spread])
  const repeat = Number.isFinite(cycles) ? String(cycles) : 'infinite'

  return (
    <div
      className={cn(
        'relative flex items-center justify-center select-none',
        stageClassName,
        className,
      )}
      style={{ animation: 'bird-intro var(--dur-slow) var(--ease-emphasized) both' }}
      aria-hidden
    >
      {/* Wind lines */}
      <div
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible',
          windClassName,
        )}
      >
        {windLines.map((l) => {
          return (
            <div
              key={l.id}
              className="absolute rounded-full"
              style={
                {
                  top: `calc(50% + ${l.y}px)`,
                  right: windRight,
                  width: l.width,
                  height: l.thickness,
                  background:
                    'linear-gradient(90deg, transparent 5%, var(--bird-wind, var(--foreground)) 50%, transparent 95%)',
                  '--wind-delay': `${l.delay}s`,
                  '--wind-dur': `${l.duration}s`,
                  '--wind-opacity': Math.min(0.72, l.maxOpacity * windIntensity),
                  animation: `wind-sweep var(--wind-dur, 2s) var(--wind-delay, 0s) linear ${repeat} forwards`,
                } as CSSProperties
              }
            />
          )
        })}
      </div>

      {/* A monochrome mask lets every theme paint the bird with its own semantic foreground. */}
      <div
        className="relative z-(--z-raised)"
        style={{ animation: `bird-drift 6s var(--ease-standard) ${repeat}` }}
      >
        <div
          className={cn('aspect-square object-contain', birdClassName)}
          style={{
            backgroundColor: 'var(--bird-foreground, var(--foreground))',
            WebkitMaskImage: `url(${maskUrl})`,
            maskImage: `url(${maskUrl})`,
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
      </div>
    </div>
  )
}
