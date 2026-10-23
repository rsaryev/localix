import type {
  IPrimitivePaneRenderer,
  IPrimitivePaneView,
  ISeriesPrimitive,
  SeriesAttachedParameter,
  Time,
} from 'lightweight-charts'
import type { PrimitiveHoveredItem } from 'lightweight-charts'
import type { ChartDrawing } from '../../backend/chart-drawing'
import { DEFAULT_DRAWING_COLOR, dashPattern } from '../model/chartDrawings'

/**
 * Series primitives (lightweight-charts v5 `attachPrimitive`) for the drawing kinds the library
 * has no native object for: the trendline segment and the vertical time marker (`createPriceLine`
 * is price-axis only — the hline uses it natively in `drawingLayer.ts`). Per the primitive
 * contract, coordinates are computed in `updateAllViews` (the library calls it whenever the
 * viewport changes) and the renderer only draws the cached values; a point whose time falls
 * outside the loaded history yields a null coordinate and the drawing quietly skips that frame.
 */

/** The fancy-canvas render target, named via the interface so we don't import a transitive dep. */
type RenderTarget = Parameters<IPrimitivePaneRenderer['draw']>[0]

interface Stroke {
  color: string
  dash: number[]
}

const strokeOf = (d: ChartDrawing): Stroke => ({
  color: d.color ?? DEFAULT_DRAWING_COLOR,
  dash: dashPattern(d.lineStyle),
})

function strokePath(
  target: RenderTarget,
  stroke: Stroke,
  path: (ctx: CanvasRenderingContext2D, height: number) => void,
  highlighted = false,
): void {
  target.useMediaCoordinateSpace(({ context, mediaSize }) => {
    context.save()
    context.strokeStyle = stroke.color
    context.lineWidth = highlighted ? 3 : 1
    context.setLineDash(stroke.dash)
    context.beginPath()
    path(context, mediaSize.height)
    context.stroke()
    context.restore()
  })
}

/** The hover a line drawing reports when the pointer is within six pixels of it, else none. */
export function drawingHit(id: string, distance: number): PrimitiveHoveredItem | null {
  return distance <= 6
    ? {
        externalId: `drawing:${id}`,
        zOrder: 'normal',
        distance,
        hitTestPriority: 1,
        cursorStyle: 'pointer',
      }
    : null
}

/** A straight segment between two {time, price} points, drawn on the series' pane. */
export class TrendlinePrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null
  private coords: { x1: number; y1: number; x2: number; y2: number } | null = null
  private readonly views: IPrimitivePaneView[]
  private readonly drawing: Extract<ChartDrawing, { kind: 'trendline' }>
  private highlighted = false

  constructor(drawing: Extract<ChartDrawing, { kind: 'trendline' }>) {
    this.drawing = drawing
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        const c = this.coords
        if (!c) return
        strokePath(
          target,
          strokeOf(this.drawing),
          (ctx) => {
            ctx.moveTo(c.x1, c.y1)
            ctx.lineTo(c.x2, c.y2)
          },
          this.highlighted,
        )
      },
    }
    this.views = [{ renderer: () => renderer }]
  }

  setHighlighted(value: boolean): void {
    this.highlighted = value
    this.param?.requestUpdate()
  }

  hitTest(x: number, y: number): PrimitiveHoveredItem | null {
    const c = this.coords
    if (!c) return null
    const dx = c.x2 - c.x1
    const dy = c.y2 - c.y1
    const length2 = dx * dx + dy * dy
    const t =
      length2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - c.x1) * dx + (y - c.y1) * dy) / length2))
    return drawingHit(this.drawing.id, Math.hypot(x - (c.x1 + t * dx), y - (c.y1 + t * dy)))
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
    param.requestUpdate()
  }

  detached(): void {
    this.param = null
  }

  updateAllViews(): void {
    const p = this.param
    if (!p) return void (this.coords = null)
    const ts = p.chart.timeScale()
    const d = this.drawing
    const x1 = ts.timeToCoordinate(d.time1 as Time)
    const x2 = ts.timeToCoordinate(d.time2 as Time)
    const y1 = p.series.priceToCoordinate(d.price1)
    const y2 = p.series.priceToCoordinate(d.price2)
    this.coords =
      x1 !== null && x2 !== null && y1 !== null && y2 !== null ? { x1, y1, x2, y2 } : null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}

/** A vertical line across the pane at one time. */
export class VerticalLinePrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null
  private x: number | null = null
  private readonly views: IPrimitivePaneView[]
  private readonly drawing: Extract<ChartDrawing, { kind: 'vline' }>
  private highlighted = false

  constructor(drawing: Extract<ChartDrawing, { kind: 'vline' }>) {
    this.drawing = drawing
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        const x = this.x
        if (x === null) return
        strokePath(
          target,
          strokeOf(this.drawing),
          (ctx, height) => {
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
          },
          this.highlighted,
        )
      },
    }
    this.views = [{ renderer: () => renderer }]
  }

  setHighlighted(value: boolean): void {
    this.highlighted = value
    this.param?.requestUpdate()
  }

  hitTest(x: number): PrimitiveHoveredItem | null {
    if (this.x === null) return null
    return drawingHit(this.drawing.id, Math.abs(x - this.x))
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
    param.requestUpdate()
  }

  detached(): void {
    this.param = null
  }

  updateAllViews(): void {
    const p = this.param
    this.x = p ? p.chart.timeScale().timeToCoordinate(this.drawing.time as Time) : null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}

/**
 * ALL hline labels, drawn as one primitive: tiny always-visible text sitting just above each
 * level line at the pane's left edge — the minimal replacement for the library's per-line title
 * (which crowds the axis side and cannot be restyled). One primitive for the whole set keeps the
 * per-frame cost flat however many levels are drawn.
 */
export class HlineLabelsPrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null
  private labels: Array<{ price: number; text: string; color: string }> = []
  private coords: Array<{ y: number; text: string; color: string }> = []
  private readonly views: IPrimitivePaneView[]

  constructor() {
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        if (this.coords.length === 0) return
        target.useMediaCoordinateSpace(({ context: ctx }) => {
          ctx.save()
          ctx.font = '9px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
          ctx.textBaseline = 'bottom'
          ctx.textAlign = 'left'
          for (const label of this.coords) {
            ctx.fillStyle = label.color
            ctx.fillText(label.text, 6, label.y - 2)
          }
          ctx.restore()
        })
      },
    }
    this.views = [{ renderer: () => renderer, zOrder: () => 'top' as const }]
  }

  /** Replace the label set (price + short text + color per hline that has a label). */
  setLabels(labels: Array<{ price: number; text: string; color: string }>): void {
    this.labels = labels
    this.param?.requestUpdate?.()
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
  }

  detached(): void {
    this.param = null
  }

  updateAllViews(): void {
    this.coords = []
    const series = this.param?.series
    if (!series) return
    for (const label of this.labels) {
      const y = series.priceToCoordinate(label.price)
      if (y !== null) this.coords.push({ y, text: label.text, color: label.color })
    }
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}

/**
 * A supply/demand ZONE — a shaded horizontal band between two prices, spanning the full pane width
 * (a zone extends forward in time). Drawn at `bottom` z-order so candles and lines sit on top; the
 * two edges are faint lines so the band reads as a region, not a fill that swallows price. Attaches
 * to the main series (it needs `priceToCoordinate`); highlight thickens the edges.
 */
export class ZonePrimitive implements ISeriesPrimitive<Time> {
  private param: SeriesAttachedParameter<Time> | null = null
  private ys: { top: number; bottom: number } | null = null
  private readonly views: IPrimitivePaneView[]
  private readonly drawing: Extract<ChartDrawing, { kind: 'zone' }>
  private highlighted = false

  constructor(drawing: Extract<ChartDrawing, { kind: 'zone' }>) {
    this.drawing = drawing
    const color = drawing.color ?? DEFAULT_DRAWING_COLOR
    const renderer: IPrimitivePaneRenderer = {
      draw: (target) => {
        const ys = this.ys
        if (!ys) return
        target.useMediaCoordinateSpace(({ context: ctx, mediaSize }) => {
          ctx.save()
          // Low-alpha fill; the hex is always #rrggbb here (the draw guard enforces hex), so a
          // 2-digit alpha suffix is safe.
          ctx.fillStyle = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}22` : color
          ctx.fillRect(0, ys.top, mediaSize.width, ys.bottom - ys.top)
          ctx.strokeStyle = /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}99` : color
          ctx.lineWidth = this.highlighted ? 2 : 1
          ctx.beginPath()
          ctx.moveTo(0, ys.top)
          ctx.lineTo(mediaSize.width, ys.top)
          ctx.moveTo(0, ys.bottom)
          ctx.lineTo(mediaSize.width, ys.bottom)
          ctx.stroke()
          ctx.restore()
        })
      },
    }
    this.views = [{ renderer: () => renderer, zOrder: () => 'bottom' as const }]
  }

  setHighlighted(value: boolean): void {
    this.highlighted = value
    this.param?.requestUpdate()
  }

  attached(param: SeriesAttachedParameter<Time>): void {
    this.param = param
    param.requestUpdate()
  }

  detached(): void {
    this.param = null
  }

  updateAllViews(): void {
    const p = this.param
    if (!p) return void (this.ys = null)
    const y1 = p.series.priceToCoordinate(this.drawing.price1)
    const y2 = p.series.priceToCoordinate(this.drawing.price2)
    this.ys =
      y1 !== null && y2 !== null ? { top: Math.min(y1, y2), bottom: Math.max(y1, y2) } : null
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return this.views
  }
}
