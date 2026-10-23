import { useMemo } from 'react'
import {
  formatCell,
  normalizeY,
  type ChartSpec,
  type TableColumn,
  type TableRow,
} from '@localixai/dataview'
import { bandScale, extent, formatTick, linearScale, niceTicks, seriesColor } from './scales'
import {
  AXIS_LABEL_BASELINE,
  AXIS_LABEL_GAP,
  AXIS_TICK_FONT,
  CHART_FRAME_INSET,
  LEGEND_ENTRY_GAP,
  LEGEND_LABEL_GAP,
  LEGEND_SWATCH,
  LEGEND_SWATCH_RADIUS,
  LEGEND_SWATCH_Y,
} from './geometry'

interface CartesianChartProps {
  columns: TableColumn[]
  rows: TableRow[]
  spec: ChartSpec
  width: number
  height: number
}

// Top/right are the shared frame inset, so a cartesian panel breathes like the
// pie panel next to it. Bottom and left additionally reserve room for the tick
// labels (and, at the bottom, the legend row under them).
const M = {
  top: CHART_FRAME_INSET,
  right: CHART_FRAME_INSET,
  bottom: 40,
  left: 52,
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v)
}

/** Bar / line / area / scatter on a shared cartesian frame. */
/** Cartesian renderer shared by host and mini app table surfaces. */
export function CartesianChart({ columns, rows, spec, width, height }: CartesianChartProps) {
  const plotW = Math.max(10, width - M.left - M.right)
  const plotH = Math.max(10, height - M.top - M.bottom)

  const model = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]))
    const yIds = normalizeY(spec.y).filter((id) => byId.has(id))
    const xId = spec.x && byId.has(spec.x) ? spec.x : undefined

    if (spec.kind === 'scatter') {
      const yId = yIds[0]
      if (!xId || !yId) return null
      const pts = rows.flatMap((r) => {
        const p = { x: num(r[xId]), y: num(r[yId]) }
        return Number.isFinite(p.x) && Number.isFinite(p.y) ? [p] : []
      })
      const [xmin, xmax] = extent(pts.map((p) => p.x))
      const [ymin, ymax] = extent(pts.map((p) => p.y))
      return {
        mode: 'scatter' as const,
        pts,
        xLabel: byId.get(xId)?.title ?? xId,
        yLabel: byId.get(yId)?.title ?? yId,
        xScaleDomain: [xmin, xmax] as [number, number],
        yDomain: [ymin, ymax] as [number, number],
      }
    }

    if (!xId || yIds.length === 0) return null
    const categories = rows.map((r) => formatCell(r[xId]))
    const series = yIds.map((id, i) => ({
      id,
      name: byId.get(id)?.title ?? id,
      color: seriesColor(i),
      values: rows.map((r) => {
        const n = num(r[id])
        return Number.isFinite(n) ? n : 0
      }),
    }))
    const stacked = spec.kind !== 'line' && spec.stack === true
    let dataMin = 0
    let dataMax = 0
    if (stacked) {
      rows.forEach((_, ri) => {
        const sum = series.reduce((a, s) => a + Math.max(0, s.values[ri]), 0)
        if (sum > dataMax) dataMax = sum
      })
    } else {
      for (const s of series) {
        for (const v of s.values) {
          if (v > dataMax) dataMax = v
          if (v < dataMin) dataMin = v
        }
      }
    }
    const includeZero = spec.kind === 'bar' || spec.kind === 'area'
    const yDomain: [number, number] = includeZero
      ? [Math.min(0, dataMin), Math.max(0, dataMax)]
      : [dataMin, dataMax]
    return { mode: spec.kind, categories, series, stacked, yDomain }
  }, [columns, rows, spec])

  if (!model || rows.length === 0) {
    return <EmptyChart message={rows.length === 0 ? 'No rows to plot' : 'Pick chart columns'} />
  }

  const yScale = linearScale(model.yDomain[0], model.yDomain[1], plotH, 0)
  const yTicks = niceTicks(model.yDomain[0], model.yDomain[1], 5)

  return (
    <svg width={width} height={height} className="text-text-faint" role="img">
      <g transform={`translate(${M.left},${M.top})`}>
        {/* y grid + ticks */}
        {yTicks.map((t) => (
          <g key={t} transform={`translate(0,${yScale(t)})`}>
            <line x1={0} x2={plotW} stroke="currentColor" strokeOpacity={0.15} />
            <text
              x={-AXIS_LABEL_GAP}
              y={3}
              textAnchor="end"
              fontSize={AXIS_TICK_FONT}
              fill="currentColor"
            >
              {formatTick(t)}
            </text>
          </g>
        ))}
        <line x1={0} y1={plotH} x2={plotW} y2={plotH} stroke="currentColor" strokeOpacity={0.4} />

        {model.mode === 'scatter' ? (
          <ScatterMarks model={model} plotW={plotW} plotH={plotH} yScale={yScale} />
        ) : (
          <CategoryMarks
            model={model}
            plotW={plotW}
            plotH={plotH}
            yScale={yScale}
            kind={spec.kind}
          />
        )}
      </g>
      {model.mode !== 'scatter' && (
        <Legend
          series={model.series}
          x={M.left}
          // Same inset off the bottom edge as the top/right frame, so the
          // legend sits in the frame rather than 4px nearer the edge than the
          // marks are to theirs.
          y={height - CHART_FRAME_INSET}
          max={width - M.left}
        />
      )}
    </svg>
  )
}

function CategoryMarks({
  model,
  plotW,
  plotH,
  yScale,
  kind,
}: {
  model: {
    categories: string[]
    series: { id: string; name: string; color: string; values: number[] }[]
    stacked: boolean
  }
  plotW: number
  plotH: number
  yScale: (v: number) => number
  kind: ChartSpec['kind']
}) {
  const { categories, series, stacked } = model
  const band = bandScale(categories.length, 0, plotW, 0.25)
  const zeroY = yScale(0)
  const labelEvery = Math.ceil(categories.length / 12)

  return (
    <>
      {/* x labels (thinned) */}
      {categories.map((c, i) =>
        i % labelEvery === 0 ? (
          <text
            key={`x${i}`}
            x={band.center(i)}
            y={plotH + AXIS_LABEL_BASELINE}
            textAnchor="middle"
            fontSize={AXIS_TICK_FONT}
            fill="currentColor"
          >
            {c.length > 10 ? `${c.slice(0, 9)}…` : c}
          </text>
        ) : null,
      )}

      {kind === 'bar' &&
        categories.map((_, ri) => {
          if (stacked) {
            let acc = 0
            return series.map((s) => {
              const v = Math.max(0, s.values[ri])
              const y0 = yScale(acc)
              const y1 = yScale(acc + v)
              acc += v
              return (
                <rect
                  key={`${s.id}-${ri}`}
                  x={band.center(ri) - band.bandwidth / 2}
                  y={y1}
                  width={band.bandwidth}
                  height={Math.max(0, y0 - y1)}
                  style={{ fill: s.color }}
                />
              )
            })
          }
          const bw = band.bandwidth / series.length
          return series.map((s, si) => {
            const v = s.values[ri]
            const y = yScale(Math.max(0, v))
            const h = Math.abs(yScale(v) - zeroY)
            return (
              <rect
                key={`${s.id}-${ri}`}
                x={band.center(ri) - band.bandwidth / 2 + si * bw}
                y={Math.min(y, zeroY)}
                width={Math.max(1, bw - 1)}
                height={Math.max(0, h)}
                style={{ fill: s.color }}
              />
            )
          })
        })}

      {(kind === 'line' || kind === 'area') &&
        series.map((s) => {
          const pts = s.values.map((v, i) => `${band.center(i)},${yScale(v)}`)
          if (kind === 'area') {
            const d = `M ${band.center(0)},${zeroY} L ${pts.join(' L ')} L ${band.center(s.values.length - 1)},${zeroY} Z`
            return (
              <path
                key={s.id}
                d={d}
                style={{ fill: s.color, stroke: s.color }}
                fillOpacity={0.18}
                strokeWidth={1.5}
              />
            )
          }
          return (
            <polyline
              key={s.id}
              points={pts.join(' ')}
              fill="none"
              style={{ stroke: s.color }}
              strokeWidth={1.75}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )
        })}
    </>
  )
}

function ScatterMarks({
  model,
  plotW,
  plotH,
  yScale,
}: {
  model: {
    pts: { x: number; y: number }[]
    xScaleDomain: [number, number]
    xLabel: string
    yLabel: string
  }
  plotW: number
  plotH: number
  yScale: (v: number) => number
}) {
  const xScale = linearScale(model.xScaleDomain[0], model.xScaleDomain[1], 0, plotW)
  const xTicks = niceTicks(model.xScaleDomain[0], model.xScaleDomain[1], 6)
  return (
    <>
      {xTicks.map((t) => (
        <text
          key={t}
          x={xScale(t)}
          y={plotH + AXIS_LABEL_BASELINE}
          textAnchor="middle"
          fontSize={AXIS_TICK_FONT}
          fill="currentColor"
        >
          {formatTick(t)}
        </text>
      ))}
      {model.pts.map((p, i) => (
        <circle
          key={i}
          cx={xScale(p.x)}
          cy={yScale(p.y)}
          r={2.5}
          style={{ fill: seriesColor(0) }}
          fillOpacity={0.7}
        />
      ))}
    </>
  )
}

function Legend({
  series,
  x,
  y,
  max,
}: {
  series: { id: string; name: string; color: string }[]
  x: number
  y: number
  max: number
}) {
  if (series.length <= 1) return null
  const entryPadding = LEGEND_SWATCH + LEGEND_LABEL_GAP + LEGEND_ENTRY_GAP
  const widths = series.map((s) => Math.min(140, s.name.length * 6.5 + entryPadding))
  // Prefix sums place each legend entry without mutating across the map.
  const offsets = widths.map((_, i) => widths.slice(0, i).reduce((a, b) => a + b, 0))
  return (
    <g transform={`translate(${x},${y})`} className="text-text-soft">
      {series.map((s, i) => {
        const tx = offsets[i]!
        if (tx > max) return null
        return (
          <g key={s.id} transform={`translate(${tx},0)`}>
            <rect
              width={LEGEND_SWATCH}
              height={LEGEND_SWATCH}
              y={LEGEND_SWATCH_Y}
              rx={LEGEND_SWATCH_RADIUS}
              style={{ fill: s.color }}
            />
            <text
              x={LEGEND_SWATCH + LEGEND_LABEL_GAP}
              y={0}
              fontSize={AXIS_TICK_FONT}
              fill="currentColor"
            >
              {s.name.length > 16 ? `${s.name.slice(0, 15)}…` : s.name}
            </text>
          </g>
        )
      })}
    </g>
  )
}

export function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center text-xs text-text-faint">
      {message}
    </div>
  )
}
