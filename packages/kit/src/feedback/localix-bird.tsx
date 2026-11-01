import { useMemo, type CSSProperties } from 'react'

/** Where the bird's red eye sits in its artwork's 2048-unit square, shape by shape. */
const EYE: ReadonlyArray<readonly [fill: string, d: string]> = [
  [
    '#b9170a',
    'M 1570.05 574.546 C 1587.71 580.158 1611.32 584.493 1627.28 590.621 L 1625.75 590.984 C 1610.76 594.622 1585.98 608.958 1573.39 600.26 C 1572.42 598.292 1569.84 595.524 1568.32 593.713 L 1563.72 586.984 C 1566.64 585.222 1566.41 585.204 1568.23 582.247 L 1568.1 580.848 C 1567.47 577.65 1567.96 578.288 1570.05 574.546 z',
  ],
  [
    '#fbd5cd',
    'M 1568.1 580.848 C 1575.05 581.635 1592.89 587.906 1600.25 590.391 C 1593.98 592.748 1587.63 595.788 1581.08 595.846 C 1579.28 594.709 1578.95 594.569 1577.34 593.186 C 1575.77 590.006 1570.85 585.128 1568.23 582.247 L 1568.1 580.848 z',
  ],
  [
    '#953818',
    'M 1554.23 570.107 C 1558.83 571.45 1565.56 573.615 1570.05 574.546 C 1567.96 578.288 1567.47 577.65 1568.1 580.848 L 1568.23 582.247 C 1566.41 585.204 1566.64 585.222 1563.72 586.984 C 1561.7 585.055 1558.82 582.684 1556.66 580.801 C 1558.2 574.237 1555.15 579.964 1554.23 570.107 z',
  ],
  [
    '#b9170a',
    'M 1541.41 567.3 C 1545.43 568.244 1550.21 569.501 1554.23 570.107 C 1555.15 579.964 1558.2 574.237 1556.66 580.801 L 1550.06 577.305 L 1540.55 572.617 C 1541.08 572.025 1541.94 570.654 1542.42 569.945 L 1541.41 567.3 z',
  ],
  [
    '#77211f',
    'M 1524.57 564.306 L 1541.41 567.3 L 1542.42 569.945 C 1541.94 570.654 1541.08 572.025 1540.55 572.617 L 1524.57 564.306 z',
  ],
]

interface WindLine {
  id: number
  y: number
  width: number
  delay: number
  duration: number
  maxOpacity: number
  thickness: number
}

/**
 * Wind lines, seeded by index (no Math.random) so repeat renders and a prerender agree. Distances
 * are in em of the bird, so the whole stage scales with it.
 */
function buildWindLines(count: number): WindLine[] {
  return Array.from({ length: count }, (_, i) => {
    const r = (n: number) => (((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1) + 1) % 1
    const duration = 1.4 + r(1) * 1.8
    return {
      id: i,
      y: (r(2) - 0.5) * 1.75,
      width: 0.95 + r(3) * 1.6,
      delay: -r(4) * duration,
      duration,
      maxOpacity: 0.16 + r(5) * 0.3,
      thickness: 1.2 + r(6) * 2,
    }
  })
}

/** The bird's height: `md` for the empty state of a surface, `text` for 1em of the text around it. */
export type LocalixBirdSize = 'md' | 'text'
const SIZE: Record<LocalixBirdSize, string | undefined> = { md: '5rem', text: undefined }

export interface LocalixBirdProps {
  /**
   * The bird's artwork, served by the host: it is the mask the bird is painted through, in the
   * theme's foreground (`--bird-foreground` overrides it), so any theme gets a readable bird.
   */
  src: string
  size?: LocalixBirdSize
  /** Wind lines sweeping past. */
  lineCount?: number
  /**
   * How many times the wind and the drift play before the bird settles; `Infinity` never settles.
   * A stage animating forever keeps the window recompositing every frame, so a screen the app idles
   * on should weigh that. Settled, the wind ends invisible and the bird at rest.
   */
  cycles?: number
  /** At rest: no intro, drift or wind (reduced motion). */
  still?: boolean
}

/**
 * The Localix bird in flight, with its red eye: it drifts while wind lines sweep past. Decorative;
 * the keyframes (bird-intro, bird-drift, wind-sweep) are the kit's motion styles.
 */
export function LocalixBird({
  src,
  size = 'md',
  lineCount = 18,
  cycles = 3,
  still = false,
}: LocalixBirdProps) {
  const windLines = useMemo(() => buildWindLines(still ? 0 : lineCount), [still, lineCount])
  const repeat = Number.isFinite(cycles) ? String(cycles) : 'infinite'
  const mask = `url(${src})`

  return (
    <div
      className="relative flex size-[1.75em] items-center justify-center select-none"
      style={{
        fontSize: SIZE[size],
        animation: still ? undefined : 'bird-intro var(--dur-slow) var(--ease-emphasized) both',
      }}
      aria-hidden="true"
    >
      <div className="pointer-events-none absolute inset-0 overflow-visible">
        {windLines.map((l) => (
          <div
            key={l.id}
            className="absolute rounded-full"
            style={
              {
                top: `calc(50% + ${l.y}em)`,
                right: '-0.8em',
                width: `${l.width}em`,
                height: l.thickness,
                opacity: 0,
                background:
                  'linear-gradient(90deg, transparent 5%, var(--bird-wind, var(--bird-foreground, var(--foreground))) 50%, transparent 95%)',
                '--wind-delay': `${l.delay}s`,
                '--wind-dur': `${l.duration}s`,
                '--wind-opacity': l.maxOpacity,
                animation: `wind-sweep calc(var(--wind-dur, 2s) * var(--bird-wind-duration-scale, 1)) var(--wind-delay, 0s) linear ${repeat} forwards`,
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div
        className="relative size-[1em]"
        style={
          still
            ? undefined
            : {
                animation: `bird-drift var(--bird-drift-duration, 6s) var(--ease-standard) ${repeat}`,
              }
        }
      >
        <div
          className="size-full"
          style={{
            backgroundColor: 'var(--bird-foreground, var(--foreground))',
            WebkitMaskImage: mask,
            maskImage: mask,
            WebkitMaskPosition: 'center',
            maskPosition: 'center',
            WebkitMaskRepeat: 'no-repeat',
            maskRepeat: 'no-repeat',
            WebkitMaskSize: 'contain',
            maskSize: 'contain',
          }}
        />
        {/* The one-colour mask loses the eye, so it goes back on top in its own colours. */}
        <svg className="absolute inset-0 size-full" viewBox="0 0 2048 2048">
          {EYE.map(([fill, d]) => (
            <path key={d} fill={fill} d={d} />
          ))}
        </svg>
      </div>
    </div>
  )
}
