import { cn } from '@localixai/mini-app-sdk/ui/classes'
import type { RatingGroup, RatingVerdict } from '../model/technicalRatings'

/**
 * One rating dial: a semicircular five-zone arc (strong sell → strong buy) with
 * a needle at the group's score, the verdict named under it and the sell/neutral/buy counts under
 * that. Pure SVG. Zone/needle colors are set through the theme's CSS variables DIRECTLY (not
 * `stroke-*` utility classes) so the dial can never lose its paint to a missed utility.
 */

const VERDICT_LABEL: Record<RatingVerdict, string> = {
  strong_sell: 'Strong sell',
  sell: 'Sell',
  neutral: 'Neutral',
  buy: 'Buy',
  strong_buy: 'Strong buy',
}

const VERDICT_TONE: Record<RatingVerdict, string> = {
  strong_sell: 'text-status-error',
  sell: 'text-status-error/80',
  neutral: 'text-text-soft',
  buy: 'text-status-success/80',
  strong_buy: 'text-status-success',
}

/** Polar → cartesian on the dial (0° = left / strong sell, 180° = right / strong buy). */
function point(cx: number, cy: number, r: number, deg: number): [number, number] {
  const rad = (Math.PI * (180 - deg)) / 180
  return [cx + r * Math.cos(rad), cy - r * Math.sin(rad)]
}

function arc(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const [x1, y1] = point(cx, cy, r, fromDeg)
  const [x2, y2] = point(cx, cy, r, toDeg)
  return `M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 0 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`
}

/** 50%-strength of a theme color without needing a generated utility. */
const half = (cssVar: string) => `color-mix(in oklab, var(${cssVar}) 55%, transparent)`

/** The five zones in dial order, mapped from the gauge bands (score −1..1 → 0°..180°). */
const ZONES: Array<{ from: number; to: number; stroke: string }> = [
  { from: 0, to: 45, stroke: 'var(--status-error)' }, // strong sell (−1 .. −0.5)
  { from: 45, to: 81, stroke: half('--status-error') }, // sell (−0.5 .. −0.1)
  { from: 81, to: 99, stroke: half('--text-faint') }, // neutral (−0.1 .. 0.1)
  { from: 99, to: 135, stroke: half('--status-success') }, // buy (0.1 .. 0.5)
  { from: 135, to: 180, stroke: 'var(--status-success)' }, // strong buy (0.5 .. 1)
]

export function RatingGauge({
  title,
  group,
  size = 'md',
}: {
  title: string
  group: RatingGroup
  /** `lg` is the center Summary dial. */
  size?: 'md' | 'lg'
}) {
  const score = group.score ?? 0
  const angle = ((score + 1) / 2) * 180
  const [nx, ny] = point(60, 54, 32, angle)
  return (
    <div className="flex w-44 flex-col items-center gap-1 text-center">
      <svg viewBox="0 0 120 62" className={size === 'lg' ? 'w-44' : 'w-36'} aria-hidden>
        {ZONES.map((z) => (
          <path
            key={z.from}
            d={arc(60, 54, 44, z.from + 2, z.to - 2)}
            stroke={z.stroke}
            strokeWidth={7}
            strokeLinecap="round"
            fill="none"
          />
        ))}
        {/* The needle — a quiet base dot + a line to the score's angle. */}
        <line
          x1={60}
          y1={54}
          x2={nx.toFixed(2)}
          y2={ny.toFixed(2)}
          stroke="var(--foreground)"
          strokeWidth={2.5}
          strokeLinecap="round"
        />
        <circle cx={60} cy={54} r={3.5} fill="var(--foreground)" />
      </svg>
      <span
        className={cn(
          'font-semibold',
          size === 'lg' ? 'text-base' : 'text-sm',
          VERDICT_TONE[group.verdict],
        )}
      >
        {group.score === null ? '—' : VERDICT_LABEL[group.verdict]}
      </span>
      <span className="text-2xs uppercase tracking-wider text-text-faint">{title}</span>
      <span className="text-2xs tabular-nums text-text-faint">
        <span className="text-status-error/80">{group.sells} sell</span>
        <span className="mx-1">·</span>
        <span>{group.neutrals} neutral</span>
        <span className="mx-1">·</span>
        <span className="text-status-success/80">{group.buys} buy</span>
      </span>
    </div>
  )
}
