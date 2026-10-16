import { useMemo } from 'react'
import {
  formatCell,
  normalizeY,
  type ChartSpec,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'
import { seriesColor } from './scales'
import { CHART_FRAME_INSET, CHART_LEGEND_GAP } from './geometry'
import { EmptyChart } from './CartesianChart'

interface PieChartProps {
  columns: TableColumn[]
  rows: TableRow[]
  spec: ChartSpec
  width: number
  height: number
}

const MAX_SLICES = 8

/** Pie renderer shared by host and plugin table surfaces. */
export function PieChart({ columns, rows, spec, width, height }: PieChartProps) {
  const model = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]))
    const labelId = spec.x && byId.has(spec.x) ? spec.x : undefined
    const valueId = normalizeY(spec.y).find((id) => byId.has(id))
    if (!labelId || !valueId) return null
    const agg = new Map<string, number>()
    for (const r of rows) {
      const label = formatCell(r[labelId]) || '—'
      const v = typeof r[valueId] === 'number' ? (r[valueId] as number) : Number(r[valueId])
      if (!Number.isFinite(v) || v <= 0) continue
      agg.set(label, (agg.get(label) ?? 0) + v)
    }
    let entries = [...agg.entries()].sort((a, b) => b[1] - a[1])
    if (entries.length > MAX_SLICES) {
      const top = entries.slice(0, MAX_SLICES - 1)
      const other = entries.slice(MAX_SLICES - 1).reduce((a, [, v]) => a + v, 0)
      entries = [...top, ['Other', other]]
    }
    const total = entries.reduce((a, [, v]) => a + v, 0)
    return { entries, total }
  }, [columns, rows, spec])

  if (!model || model.total <= 0) return <EmptyChart message="No positive values to plot" />

  // Measure against the frame this actually renders (`p-3` all round, `gap-4`
  // before the legend): the pie used to subtract a flat 16, which is less than
  // the 24px of vertical padding it sits inside, so a short panel clipped it.
  const innerHeight = height - CHART_FRAME_INSET * 2
  const innerWidth = width - CHART_FRAME_INSET * 2 - CHART_LEGEND_GAP
  const size = Math.max(40, Math.min(innerHeight, innerWidth / 2))
  const r = size / 2 - 4
  const c = size / 2
  const START = -Math.PI / 2
  const fracs = model.entries.map(([, v]) => v / model.total)
  // Prefix sums (n ≤ 8) give each slice's start without mutating across the map.
  const offsets = fracs.map((_, i) => fracs.slice(0, i).reduce((a, b) => a + b, 0))
  const slices = model.entries.map(([label], i) => {
    const frac = fracs[i]!
    const a0 = START + offsets[i]! * 2 * Math.PI
    const a1 = a0 + frac * 2 * Math.PI
    const large = a1 - a0 > Math.PI ? 1 : 0
    const x0 = c + r * Math.cos(a0)
    const y0 = c + r * Math.sin(a0)
    const x1 = c + r * Math.cos(a1)
    const y1 = c + r * Math.sin(a1)
    // Full-circle guard: a single 100% slice can't be drawn as one arc.
    const d =
      frac >= 0.999
        ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`
        : `M ${c} ${c} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`
    return { d, color: seriesColor(i), label, pct: frac }
  })

  return (
    <div className="flex h-full w-full items-center gap-4 p-3">
      <svg
        width={size}
        height={size}
        className="shrink-0"
        style={{ width: size, height: size }}
        role="img"
      >
        {slices.map((s) => (
          <path
            key={s.label}
            d={s.d}
            style={{ fill: s.color, stroke: 'var(--background)' }}
            strokeWidth={1}
          />
        ))}
      </svg>
      <ul className="flex min-w-0 flex-1 flex-col gap-1 overflow-auto scrollbar-thin">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-text-soft">{s.label}</span>
            <span className="shrink-0 tabular-nums text-text-faint">
              {(s.pct * 100).toFixed(1)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
