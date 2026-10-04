import type {
  IChartApi,
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesApi,
  ISeriesPrimitive,
  LineData,
  SeriesAttachedParameter,
  SeriesType,
  Time,
} from 'lightweight-charts'

/**
 * Fill the region between two lines of one indicator (Bollinger/Keltner/Donchian bands, the
 * Ichimoku cloud) — an `ISeriesPrimitive` attached to the indicator's FIRST series, drawn at
 * `bottom` z-order so the shade sits behind every line and the candles.
 *
 * The two lines arrive as the same `LineData[]` the series were fed (aligned by time here, since
 * their heads can differ); coordinates are recomputed in `updateAllViews` — the hook the library
 * calls exactly once per paint — and the renderer only replays the cached polygons. `paneViews()`
 * returns one stable array reference, which is the library's cache contract.
 */

interface BandPoint {
  time: number
  a: number
  b: number
}

/** One contiguous fill run: screen-space xs plus both lines' ys, and which color it takes. */
interface FillRun {
  xs: number[]
  aYs: number[]
  bYs: number[]
  up: boolean
}

class BandFillRenderer implements IPrimitivePaneRenderer {
  private readonly view: BandFillView

  constructor(view: BandFillView) {
    this.view = view
  }

  draw(target: Parameters<IPrimitivePaneRenderer['draw']>[0]): void {
    const { runs, upColor, downColor } = this.view
    if (runs.length === 0) return
    target.useMediaCoordinateSpace(({ context: ctx }) => {
      for (const run of runs) {
        if (run.xs.length < 2) continue
        ctx.beginPath()
        ctx.moveTo(run.xs[0]!, run.aYs[0]!)
        for (let i = 1; i < run.xs.length; i++) ctx.lineTo(run.xs[i]!, run.aYs[i]!)
        for (let i = run.xs.length - 1; i >= 0; i--) ctx.lineTo(run.xs[i]!, run.bYs[i]!)
        ctx.closePath()
        ctx.fillStyle = run.up ? upColor : (downColor ?? upColor)
        ctx.fill()
      }
    })
  }
}

class BandFillView implements IPrimitivePaneView {
  runs: FillRun[] = []
  private readonly rendererInstance = new BandFillRenderer(this)

  private readonly owner: BandFillPrimitive
  readonly upColor: string
  readonly downColor: string | undefined

  constructor(owner: BandFillPrimitive, upColor: string, downColor: string | undefined) {
    this.owner = owner
    this.upColor = upColor
    this.downColor = downColor
  }

  zOrder(): 'bottom' {
    return 'bottom'
  }

  renderer(): IPrimitivePaneRenderer | null {
    return this.runs.length > 0 ? this.rendererInstance : null
  }

  /** Recompute the screen-space polygons from the current viewport. */
  update(): void {
    this.runs = []
    const { chart, series, points, visible } = this.owner
    if (!visible || !chart || !series || points.length < 2) return
    const timeScale = chart.timeScale()
    // When both colors are the same fill, sign splits are pointless — one run per gap-free span.
    const splitBySign = this.downColor !== undefined
    let run: FillRun | null = null
    let prevUp = true
    for (const p of points) {
      const x = timeScale.timeToCoordinate(p.time as Time)
      const aY = series.priceToCoordinate(p.a)
      const bY = series.priceToCoordinate(p.b)
      if (x === null || aY === null || bY === null) {
        run = null // an off-scale gap ends the polygon
        continue
      }
      const up = p.a >= p.b
      if (!run || (splitBySign && up !== prevUp)) {
        const next: FillRun = { xs: [], aYs: [], bYs: [], up }
        // Meet the previous run at the shared bar so a color flip has no gap.
        if (run && splitBySign && run.xs.length > 0) {
          next.xs.push(run.xs[run.xs.length - 1]!)
          next.aYs.push(run.aYs[run.aYs.length - 1]!)
          next.bYs.push(run.bYs[run.bYs.length - 1]!)
        }
        run = next
        this.runs.push(run)
      }
      run.xs.push(x)
      run.aYs.push(aY)
      run.bYs.push(bY)
      prevUp = up
    }
  }
}

export class BandFillPrimitive implements ISeriesPrimitive<Time> {
  chart: IChartApi | null = null
  series: ISeriesApi<SeriesType> | null = null
  points: BandPoint[] = []
  visible = true
  private requestUpdate: (() => void) | null = null
  private readonly view: BandFillView
  private readonly views: IPrimitivePaneView[]

  constructor(upColor: string, downColor?: string) {
    this.view = new BandFillView(this, upColor, downColor)
    this.views = [this.view]
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.chart = param.chart
    this.series = param.series
    this.requestUpdate = param.requestUpdate ?? null
  }

  detached(): void {
    this.chart = null
    this.series = null
    this.requestUpdate = null
  }

  /** Feed the two lines; times outside both are dropped (the fill needs BOTH edges). */
  setData(a: LineData[], b: LineData[]): void {
    const bByTime = new Map<number, number>()
    for (const p of b) bByTime.set(p.time as number, p.value)
    this.points = []
    for (const p of a) {
      const bv = bByTime.get(p.time as number)
      if (bv !== undefined) this.points.push({ time: p.time as number, a: p.value, b: bv })
    }
    this.requestUpdate?.()
  }

  setVisible(visible: boolean): void {
    if (this.visible === visible) return
    this.visible = visible
    this.requestUpdate?.()
  }

  updateAllViews(): void {
    this.view.update()
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}
