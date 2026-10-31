import { useMemo, type CSSProperties } from 'react'

/** Vertical spread of the wind lines, in px. */
const WIND_SPREAD = 220
/** The monochrome mask the bird is painted through. */
const MASK_URL = '/logo-dark.svg'

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
function buildWindLines(count: number): WindLine[] {
  return Array.from({ length: count }, (_, i) => {
    const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1
    const duration = 1.4 + r(1) * 1.8
    return {
      id: i,
      y: (r(2) - 0.5) * WIND_SPREAD,
      width: 120 + r(3) * 200,
      delay: -r(4) * duration,
      duration,
      maxOpacity: 0.16 + r(5) * 0.3,
      thickness: 1.2 + r(6) * 2,
    }
  })
}

interface BirdStageProps {
  lineCount?: number
  /**
   * How many times the wind and the bird's drift play before the stage settles still; `Infinity`
   * never settles. The empty chat is the screen the app sits on, and a stage animating forever
   * there (28 moving layers plus the bird) kept the window recomposited every frame for as long
   * as nobody typed: GPU and WindowServer busy on an idle app. Settled, the wind ends invisible
   * (its last keyframe, held) and the bird at rest (its last keyframe is its resting pose).
   */
  cycles?: number
  /** Render the bird at rest: no intro, drift or wind. */
  still?: boolean
}

/**
 * The Localix bird — the flying logo of the empty chat. Animations
 * (bird-intro/drift, wind-sweep) come from the shared index.css.
 *
 * The artwork is painted from semantic CSS tokens rather than selected from a
 * light/dark pair. New themes therefore inherit a readable bird automatically,
 * while `--bird-foreground` and `--bird-wind` remain optional art-direction hooks.
 */
export function BirdStage({ lineCount = 28, cycles = 3, still = false }: BirdStageProps) {
  const windLines = useMemo(() => buildWindLines(still ? 0 : lineCount), [still, lineCount])
  const repeat = Number.isFinite(cycles) ? String(cycles) : 'infinite'

  return (
    <div
      className="relative flex items-center justify-center select-none size-44"
      style={
        still ? undefined : { animation: 'bird-intro var(--dur-slow) var(--ease-emphasized) both' }
      }
      aria-hidden
    >
      {/* Wind lines */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
        {windLines.map((l) => {
          return (
            <div
              key={l.id}
              className="absolute rounded-full"
              style={
                {
                  top: `calc(50% + ${l.y}px)`,
                  right: '-40%',
                  width: l.width,
                  height: l.thickness,
                  background:
                    'linear-gradient(90deg, transparent 5%, var(--bird-wind, var(--foreground)) 50%, transparent 95%)',
                  '--wind-delay': `${l.delay}s`,
                  '--wind-dur': `${l.duration}s`,
                  '--wind-opacity': l.maxOpacity,
                  animation: `wind-sweep calc(var(--wind-dur, 2s) * var(--bird-wind-duration-scale, 1)) var(--wind-delay, 0s) linear ${repeat} forwards`,
                } as CSSProperties
              }
            />
          )
        })}
      </div>

      {/* A monochrome mask lets every theme paint the bird with its own semantic foreground. */}
      <div
        className="relative z-(--z-raised)"
        style={
          still
            ? undefined
            : {
                animation: `bird-drift var(--bird-drift-duration, 6s) var(--ease-standard) ${repeat}`,
              }
        }
      >
        <div
          className="aspect-square object-contain size-20"
          style={{
            backgroundColor: 'var(--bird-foreground, var(--foreground))',
            WebkitMaskImage: `url(${MASK_URL})`,
            maskImage: `url(${MASK_URL})`,
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
