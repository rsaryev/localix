import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'

/**
 * Shade the trading SESSIONS as a faint full-height background — the intraday context of "which
 * desks are awake": Asia, London, and the London/NY overlap (the high-volume window). Adapted from
 * the lightweight-charts `session-highlighting` example, simplified to NON-overlapping UTC bands so
 * each bar takes exactly one tint, and drawn at `bottom` z-order behind price. Attaches to the
 * VOLUME series (which persists across a chart-type swap), so it needs no re-attach plumbing; it
 * uses only x-coordinates (time → column), never a price scale.
 */

/** UTC-hour → session tint (very low alpha so price reads over it). Off-hours get none. */
function sessionColor(utcHour: number): string | null {
  if (utcHour < 8) return '#6aa8ff10' // Asia
  if (utcHour < 13) return '#f0a13a10' // London
  if (utcHour < 21) return '#4dd0a114' // London/NY overlap — the busy window
  return null // late US / pre-Asia lull
}

interface Column {
  x: number
  color: string
}

class SessionHighlightView implements IPrimitivePaneView {
  columns: Column[] = []
  halfWidth = 3
  private readonly owner: SessionHighlightPrimitive
  private readonly rendererInstance: IPrimitivePaneRenderer

  constructor(owner: SessionHighlightPrimitive) {
    this.owner = owner
    this.rendererInstance = {
      draw: () => {},
      drawBackground: (target) => {
        if (this.columns.length === 0) return
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          const half = this.halfWidth
          for (const col of this.columns) {
            ctx.fillStyle = col.color
            ctx.fillRect(col.x - half, 0, half * 2, mediaSize.height)
          }
        })
      },
    }
  }

  zOrder(): 'bottom' {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.owner.enabled && this.columns.length > 0 ? this.rendererInstance : null
  }

  update(): void {
    this.columns = []
    const { chart, enabled, times } = this.owner
    if (!chart || !enabled || times.length === 0) return
    const ts = chart.timeScale()
    // Column half-width from the bar spacing, so adjacent columns of the same tint meet flush.
    this.halfWidth = Math.max(1, ts.options().barSpacing / 2)
    for (const time of times) {
      const color = sessionColor(new Date(time * 1000).getUTCHours())
      if (!color) continue
      const x = ts.timeToCoordinate(time as Time)
      if (x !== null) this.columns.push({ x, color })
    }
  }
}

export class SessionHighlightPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null
  times: number[] = []
  enabled = false
  private requestUpdate: (() => void) | null = null
  private readonly view: SessionHighlightView
  private readonly views: IPrimitivePaneView[]

  constructor() {
    this.view = new SessionHighlightView(this)
    this.views = [this.view]
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart
    this.requestUpdate = param.requestUpdate ?? null
  }

  detached(): void {
    this.chart = null
    this.requestUpdate = null
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return
    this.enabled = enabled
    this.requestUpdate?.()
  }

  /** Feed the bar times (unix seconds) — the columns to shade. */
  setTimes(times: number[]): void {
    this.times = times
    this.requestUpdate?.()
  }

  updateAllViews(): void {
    this.view.update()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}
