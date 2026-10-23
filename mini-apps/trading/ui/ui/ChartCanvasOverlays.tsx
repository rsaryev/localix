import { ChevronRight, X } from 'lucide-react'

import { cn } from '@localixai/plugin-sdk/ui/classes'
import { ActivitySignal } from '@localixai/kit/activity-orb'
import { describeChartDrawing, type ChartDrawing } from '../../backend/chart-drawing'
import {
  formatCompactVolume,
  formatCountdown,
  formatFixed,
  formatPercent,
} from '../model/formatQuote'
import type { CrosshairLegend } from '../model/crosshairLegend'
import { useSecondTick } from '../model/useSecondTick'

/** One endpoint of the measure tool in data and screen coordinates. */
export interface MeasurePoint {
  price: number
  logical: number
  x: number
  y: number
}

export function ChartLoadingOverlay() {
  return (
    <div
      className="absolute inset-0 z-(--z-controls) flex flex-col justify-end bg-background/80 px-4 py-4"
      role="status"
      aria-label="Loading chart history"
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <ActivitySignal label="Loading market history" className="text-2xs text-text-soft" />
      </div>
      <div className="flex items-end gap-1 opacity-40" aria-hidden="true">
        {[32, 48, 24, 56, 40, 64, 28, 48, 36, 60, 44, 52, 32, 68, 40, 56].map((height, index) => (
          <span
            key={index}
            // Foreground veil, not `bg-surface-raised`: raised mixes from a darker ground than the
            // chart, so the skeleton candles were black-on-black and the placeholder read empty.
            className="flex-1 rounded-sm bg-foreground/10"
            style={{ height: `${height}px` }}
          />
        ))}
      </div>
    </div>
  )
}

/** Plain flow row; the legend column owns positioning and collision avoidance. */
export function CrosshairReadout({
  legend,
  decimals,
  barCloseAt,
}: {
  legend: CrosshairLegend
  decimals: number
  barCloseAt: number | null
}) {
  const tint =
    legend.sign > 0
      ? 'text-status-success'
      : legend.sign < 0
        ? 'text-status-error'
        : 'text-text-soft'
  const pct = formatPercent(legend.changePct)
  return (
    <div className="pointer-events-none flex flex-wrap items-center gap-x-2.5 gap-y-0.5 px-1 py-0.5 text-2xs tabular-nums text-text-faint">
      <Ohlc label="O" value={legend.bar.open} decimals={decimals} tint={tint} />
      <Ohlc label="H" value={legend.bar.high} decimals={decimals} tint={tint} />
      <Ohlc label="L" value={legend.bar.low} decimals={decimals} tint={tint} />
      <Ohlc label="C" value={legend.bar.close} decimals={decimals} tint={tint} />
      <span className={cn(tint)}>{pct.text}</span>
      {legend.rangePct != null && (
        <span className="text-text-faint">
          <span className="mr-0.5 uppercase tracking-wider">R</span>
          {`${(legend.rangePct * 100).toFixed(2)}%`}
        </span>
      )}
      {legend.volume != null && (
        <span>
          <span className="mr-1 uppercase tracking-wider">Vol</span>
          <span className="text-text-soft">{formatCompactVolume(legend.volume)}</span>
        </span>
      )}
      <BarClock closeAt={barCloseAt} />
    </div>
  )
}

/** Compact wall-clock duration for a measure tool bar span. */
export function measureDuration(bars: number, intervalSeconds: number | null): string | null {
  if (!intervalSeconds || bars <= 0) return null
  let seconds = bars * intervalSeconds
  const days = Math.floor(seconds / 86_400)
  seconds -= days * 86_400
  const hours = Math.floor(seconds / 3600)
  seconds -= hours * 3600
  const minutes = Math.floor(seconds / 60)
  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function MeasureOverlay({
  measure,
  decimals,
  intervalSeconds,
}: {
  measure: { a: MeasurePoint | null; b: MeasurePoint | null }
  decimals: number
  intervalSeconds: number | null
}) {
  const { a, b } = measure
  if (!a) {
    return <MeasureHint>Measure: click the start point</MeasureHint>
  }
  if (!b) {
    return (
      <>
        <MeasureDot point={a} />
        <MeasureHint>Measure: click the end point</MeasureHint>
      </>
    )
  }
  const move = b.price - a.price
  const pct = a.price !== 0 ? (move / a.price) * 100 : 0
  const bars = Math.abs(Math.round(b.logical - a.logical))
  const duration = measureDuration(bars, intervalSeconds)
  const up = move >= 0
  return (
    <>
      <MeasureDot point={a} />
      <MeasureDot point={b} />
      {/* No backdrop-blur: at a 95% fill nothing shows through, and this box is repositioned on
          every mouse move over a live chart — the backdrop resample was pure cost. */}
      <div
        className={cn(
          'pointer-events-none absolute z-(--z-controls)flex -translate-y-1/2 flex-col gap-0.5 rounded-md border bg-surface-raised/95 px-2 py-1 text-2xs tabular-nums shadow-(--shadow-popover)',
          up ? 'border-status-success/50' : 'border-status-error/50',
        )}
        style={{
          left: `clamp(0.5rem, ${b.x + 10}px, calc(100% - 9rem))`,
          top: `clamp(2rem, ${b.y}px, calc(100% - 3rem))`,
        }}
      >
        <span className={up ? 'text-status-success' : 'text-status-error'}>
          {up ? '+' : ''}
          {formatFixed(move, decimals)} ({up ? '+' : ''}
          {pct.toFixed(2)}%)
        </span>
        <span className="text-text-faint">
          {bars} bars{duration ? ` · ${duration}` : ''}
        </span>
      </div>
    </>
  )
}

function MeasureHint({ children }: { children: string }) {
  return (
    <div className="pointer-events-none absolute left-1/2 top-2 z-(--z-controls) -translate-x-1/2 rounded-md border border-border-soft bg-surface-raised/95 px-2 py-1 text-2xs text-text-soft shadow-(--shadow-popover)">
      {children}
    </div>
  )
}

function MeasureDot({ point }: { point: MeasurePoint }) {
  return (
    <span
      className="pointer-events-none absolute z-(--z-controls)size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground ring-2 ring-background"
      style={{ left: point.x, top: point.y }}
    />
  )
}

export function SelectedDrawingAction({
  drawing,
  point,
  rightAxisWidth,
  onRemove,
}: {
  drawing: ChartDrawing
  point: { x: number; y: number }
  rightAxisWidth: number
  onRemove: () => void
}) {
  const description = describeChartDrawing(drawing)
  return (
    <div
      className="pointer-events-auto absolute z-(--z-controls)flex -translate-y-1/2 items-center gap-1 rounded-md border border-control-border-focus/60 bg-surface-raised/95 py-1 pl-2 pr-1 text-2xs text-foreground shadow-(--shadow-popover)"
      style={
        drawing.kind === 'hline'
          ? {
              right: rightAxisWidth + 4,
              top: `clamp(2rem, ${point.y}px, calc(100% - 2rem))`,
            }
          : {
              left: `clamp(0.5rem, ${point.x + 8}px, calc(100% - 13rem))`,
              top: `clamp(2rem, ${point.y}px, calc(100% - 2rem))`,
            }
      }
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span className="max-w-40 truncate" title={description}>
        {description}
      </span>
      <button
        type="button"
        title="Remove drawing"
        aria-label={`Remove ${description}`}
        onClick={onRemove}
        className="rounded-sm p-0.5 text-text-faint outline-none transition-colors hover:bg-status-error/10 hover:text-status-error focus-ring"
      >
        <X className="size-3" aria-hidden />
      </button>
    </div>
  )
}

/** Scroll-to-latest pill. Same material as the chat's scroll-to-latest button: `.lx-glass` owns
 *  fill, rim, depth and the per-theme re-tune, and `.lx-glass-trigger` on the button drives its
 *  hover/press — the pill itself must not, since the button is the hit target. */
export function LiveButton({ rightInset, onClick }: { rightInset: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title="Scroll to the latest bar"
      style={{ right: rightInset }}
      className="lx-glass-trigger absolute bottom-8 z-(--z-raised) flex rounded-full text-text-soft outline-none transition-colors hover:text-foreground focus-ring"
    >
      <span className="lx-glass flex items-center gap-1 rounded-full px-2.5 py-1 text-2xs">
        Live
        <ChevronRight className="size-3" />
      </span>
    </button>
  )
}

function BarClock({ closeAt }: { closeAt: number | null }) {
  const now = useSecondTick(closeAt !== null)
  if (closeAt === null) return null
  const text = formatCountdown(closeAt - now)
  if (!text) return null
  return (
    <span className="text-text-faint" title="Time until the current candle closes">
      <span className="mr-0.5 uppercase tracking-wider">Close</span>
      <span className="tabular-nums text-text-soft">{text}</span>
    </span>
  )
}

function Ohlc({
  label,
  value,
  decimals,
  tint,
}: {
  label: string
  value: number
  decimals: number
  tint: string
}) {
  return (
    <span>
      <span className="mr-0.5 uppercase tracking-wider">{label}</span>
      <span className={cn(tint)}>{formatFixed(value, decimals)}</span>
    </span>
  )
}
