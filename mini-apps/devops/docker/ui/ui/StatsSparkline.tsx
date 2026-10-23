import { seriesScale, sparklinePoints, summarizeSeries } from '../model/statsHistory'
import { cn } from '@localixai/mini-app-sdk/ui/classes'

/** The drawing box, in SVG user units. The element scales to its container width. */
const WIDTH = 240
const HEIGHT = 32

/**
 * A percentage series over the retained stats window: peak / mean / last, plus the trace.
 *
 * `preserveAspectRatio="none"` so the trace stretches to the panel width — the shape over
 * time is the signal here, not the aspect ratio. The series is decorative for assistive
 * tech (the numbers beside it carry the same information), so the SVG is hidden from it
 * and the readable summary is plain text.
 */
export function StatsSparkline({
  label,
  values,
  className,
}: {
  label: string
  values: readonly number[]
  className?: string
}) {
  const summary = summarizeSeries(values)
  if (!summary) return null
  const scale = seriesScale(values)
  const points = sparklinePoints(values, WIDTH, HEIGHT, scale)
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="flex items-baseline justify-between text-2xs text-text-faint">
        <span>
          {label} · last {values.length} samples
        </span>
        <span className="tabular-nums">
          peak {summary.max.toFixed(2)}% · avg {summary.avg.toFixed(2)}%
        </span>
      </div>
      <svg
        aria-hidden="true"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-8 w-full overflow-visible"
      >
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          className="text-status-info"
        />
      </svg>
    </div>
  )
}
