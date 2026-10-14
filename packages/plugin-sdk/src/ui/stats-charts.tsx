import { useEffect, useState } from 'react'
import { cn } from '@localixai/plugin-sdk/ui/classes'
import { formatBucketLabel, shortKey } from './utilities'

/**
 * One bar. Deliberately not a usage row: these charts started life measuring spend, and the shape
 * they actually need is a label, a number and an optional second line. Keeping them generic is what
 * lets a second measurable thing — external agent sessions, anything next — be drawn by this code
 * instead of by a lookalike beside it.
 */
export interface ChartPoint {
  /** Bucket identity: a day key for a trend, a model/provider/project for a distribution. */
  readonly key: string
  readonly value: number
  /** Secondary line in the hover card (e.g. token totals beside a cost). */
  readonly detail?: string
}

// Hand-rolled flex/CSS charts — no charting dependency (matches the app's
// hand-drawn viz, e.g. the UsageIndicator ring) and avoids the recharts+Vite
// React-context crash. Bars read clearly even with one or two data points,
// where an area line collapses into a solid block.

/** Categorical palette — the per-theme `--chart-N` tokens from index.css. */
const SERIES = Array.from({ length: 8 }, (_, i) => `var(--chart-${i + 1})`)

const DEFAULT_OVERFLOW_LABEL = (hidden: number) => `+${hidden} more in the breakdown below`

/**
 * The box every distribution row occupies, drillable or not.
 *
 * `isSelectable` can make some rows buttons and leave the rest plain divs in the
 * same list; only the button carried `-mx-1 px-1 py-0.5`, so a mixed list had
 * rows of two different heights (24px vs 20px) with their content on two
 * different left edges. The padded box is the one that matters — 20px bar +
 * 2×2px = the `--chrome-control-sm` rung — so both branches take it.
 */
const ROW_BOX = 'group/row -mx-1 flex items-center gap-3 px-1 py-0.5'

/** Animate a value 0→1 once on mount, so bars grow in. */
function useGrowIn(): number {
  const [t, setT] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setT(1))
    return () => cancelAnimationFrame(id)
  }, [])
  return t
}

/** Spend per bucket as hover-able bars. Bars are width-capped and left-aligned so
 *  a sparse range (2 points) reads as a bar chart, not two giant blocks; a dense
 *  range (hourly over a week) packs into thin bars like a typical usage graph. */
export function TrendChart({
  points,
  formatValue,
  bucketLabel = 'day',
  emptyLabel = 'Nothing in this range yet',
}: {
  points: readonly ChartPoint[]
  formatValue: (value: number) => string
  bucketLabel?: string
  emptyLabel?: string
}) {
  const grown = useGrowIn()
  if (points.length === 0) return <EmptyChart label={emptyLabel} />
  const max = Math.max(...points.map((p) => p.value), 0.0000001)

  return (
    <div>
      <div className="flex h-44 items-end gap-0.5">
        {points.map((p, i) => {
          const pct = (p.value / max) * 100
          // A tooltip centred on an edge bar hangs past the chart. It is `opacity-0`, not
          // `display:none`, so it still counts toward the scroll container's overflow —
          // which is how a dashboard with one chart grew a horizontal scrollbar. Bars in
          // the outer fifths anchor the tooltip to their own edge instead.
          const anchor =
            i < points.length / 5
              ? 'left-0'
              : i >= (points.length * 4) / 5
                ? 'right-0'
                : 'left-1/2 -translate-x-1/2'
          return (
            <div
              key={p.key}
              className="group/bar relative flex h-full flex-1 flex-col justify-end"
              title={`${formatBucketLabel(p.key)}: ${formatValue(p.value)}`}
            >
              {/* `bg-popover` + frost, the app's floating-panel material: this is a tooltip over
                  chart bars, and the raised ground token read as a black box on the glass theme. */}
              <div
                className={`pointer-events-none absolute -top-1 z-10 -translate-y-full whitespace-nowrap rounded-md border border-border/40 bg-popover px-2 py-1 text-2xs opacity-0 shadow-(--shadow-popover) backdrop-blur transition-opacity duration-150 group-hover/bar:opacity-100 ${anchor}`}
              >
                <div className="font-mono font-medium text-foreground">{formatValue(p.value)}</div>
                <div className="text-text-soft">
                  {formatBucketLabel(p.key)}
                  {p.detail ? ` · ${p.detail}` : ''}
                </div>
              </div>
              <div
                className="w-full rounded-t-sm bg-(--chart-1) transition-[height,opacity] duration-(--dur-slow) ease-out group-hover/bar:opacity-80"
                style={{
                  height: `${grown ? Math.max(3, pct) : 0}%`,
                  transitionDelay: `${Math.min(i * 12, 360)}ms`,
                }}
              />
            </div>
          )
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-text-faint">
        <span>
          {formatBucketLabel(points[0]?.key ?? '')} · peak {formatValue(max)}/{bucketLabel}
        </span>
        <span>{formatBucketLabel(points[points.length - 1]?.key ?? '')}</span>
      </div>
    </div>
  )
}

/** Cost distribution by model/provider as labelled, animated horizontal bars.
 *  When `onSelect` is provided each bar drills down (filters by that key). */
export function DistributionChart({
  rows,
  formatValue,
  onSelect,
  isSelectable,
  selectedKey,
  labelKey = shortKey,
  emptyLabel = 'No data for this grouping',
  overflowLabel = DEFAULT_OVERFLOW_LABEL,
}: {
  rows: readonly ChartPoint[]
  formatValue: (value: number) => string
  onSelect?: (key: string) => void
  /**
   * Which rows `onSelect` actually applies to. Defaults to all of them.
   *
   * A distribution can contain a bucket that is a LABEL rather than a value — "no working directory
   * recorded" stands for sessions with no cwd, and filtering by it would mean a directory named after
   * that sentence. Rendering it as a button that silently does nothing is worse than not offering it,
   * so a caller can say which keys are real.
   */
  isSelectable?: (key: string) => boolean
  selectedKey?: string
  /** Render a row's key (defaults to shortKey; e.g. kindLabel for the Kind grouping). */
  labelKey?: (key: string) => string
  emptyLabel?: string
  /**
   * How to word the rows this chart did not draw.
   *
   * The default names the table underneath, which is true on the usage screen this chart was written
   * for and false anywhere the chart stands alone — some contributed statistics have no breakdown
   * below, so the promise pointed at nothing. The cap itself is disclosed either way; only the place
   * to look for the rest is the consumer's to know.
   */
  overflowLabel?: (hidden: number) => string
}) {
  const grown = useGrowIn()
  if (rows.length === 0) return <EmptyChart label={emptyLabel} />
  const top = rows.slice(0, 8)
  const max = Math.max(...top.map((r) => r.value), 0.0000001)

  return (
    <div className="flex flex-col gap-2.5">
      {top.map((r, i) => {
        const selected = selectedKey === r.key
        const inner = (
          <>
            <span
              className="w-44 shrink-0 truncate font-mono text-xs text-muted-foreground transition-colors group-hover/row:text-foreground"
              title={r.key}
            >
              {labelKey(r.key)}
            </span>
            {/* Full-strength `muted`, not `/40`: under the host's glass theme `muted` is itself a
                6% veil, so `/40` of it was a 2.4% fill and the bar's TRACK — the only thing
                showing how far a bar falls short — disappeared. */}
            <div className="relative h-5 flex-1 overflow-hidden rounded-sm bg-muted">
              <div
                className="h-full rounded-sm transition-[width] duration-(--dur-slow) ease-out group-hover/row:brightness-110"
                style={{
                  width: `${grown ? Math.max(2, (r.value / max) * 100) : 0}%`,
                  background: SERIES[i % SERIES.length],
                  transitionDelay: `${i * 40}ms`,
                }}
              />
            </div>
            <span className="w-20 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">
              {formatValue(r.value)}
            </span>
          </>
        )
        return onSelect && (isSelectable?.(r.key) ?? true) ? (
          <button
            key={r.key}
            type="button"
            onClick={() => onSelect(r.key)}
            // A filter bar is a toggle, and it announced its state with a background colour alone —
            // the same view's range control has always said so out loud.
            aria-pressed={selected}
            title={`Filter by ${r.key}`}
            // The hover/active veil pair, not thinned `muted`: `muted` is itself a 6% veil under
            // the host's glass theme, so `/30` and `/40` of it were 1.8% and 2.4% fills — a row
            // gave no hover feedback and a SELECTED filter row was indistinguishable.
            className={cn(
              ROW_BOX,
              'rounded-md text-left transition-colors hover:bg-surface-hover',
              selected && 'bg-surface-active',
            )}
          >
            {inner}
          </button>
        ) : (
          <div key={r.key} className={ROW_BOX}>
            {inner}
          </div>
        )
      })}
      {rows.length > top.length && (
        <div className="text-xs text-text-faint">{overflowLabel(rows.length - top.length)}</div>
      )}
    </div>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex h-44 items-center justify-center text-xs text-text-faint">{label}</div>
  )
}
