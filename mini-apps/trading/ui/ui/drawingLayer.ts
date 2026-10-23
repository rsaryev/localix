import { LineStyle, type IPriceLine, type ISeriesPrimitive, type Time } from 'lightweight-charts'
import type { ChartDrawing, DrawingLineStyle } from '../../backend/chart-drawing'
import { DEFAULT_DRAWING_COLOR, drawingTitle } from '../model/chartDrawings'
import type { MainSeriesApi } from '../model/chartType'
import {
  HlineLabelsPrimitive,
  TrendlinePrimitive,
  VerticalLinePrimitive,
  ZonePrimitive,
} from './drawingPrimitives'

/**
 * Keeps the chart's drawing objects in step with the drawing LIST: hlines as native
 * `createPriceLine`s, trendlines/vlines as attached primitives (see `drawingPrimitives.ts`).
 * `sync` is a full clear + recreate — drawings are few and change on deliberate agent commands,
 * mirroring the indicator-rebuild philosophy. `attach` rebinds to a NEW main series after a
 * chart-type swap (the old series was removed, taking its price lines and primitives with it)
 * without touching the dead handles.
 */

const PRICE_LINE_STYLE: Record<'solid' | 'dashed' | 'dotted', LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
}

const lineStyleOf = (style: DrawingLineStyle | undefined): LineStyle =>
  PRICE_LINE_STYLE[style ?? 'solid']

/**
 * At rest a level line is QUIET: ~55% alpha, short title, no axis pill — a dozen levels must
 * read as furniture, not a wall of badges (hover/selection restores full strength + the pill).
 */
const restingColor = (color: string): string =>
  /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}8c` : color

export interface DrawingLayer {
  /** Bind to a (new) main series and redraw the current list. Old handles are forgotten, not
   *  detached — a swap already removed the series they lived on. */
  attach(series: MainSeriesApi): void
  /** Make the chart show exactly `drawings`. */
  sync(drawings: readonly ChartDrawing[]): void
  /** Emphasise the drawing under the pointer and restore the previous one. */
  highlight(id: string | null): void
  /** Remove every object from the still-live series and unbind. */
  detach(): void
}

export function createDrawingLayer(): DrawingLayer {
  let series: MainSeriesApi | null = null
  let drawings: readonly ChartDrawing[] = []
  let priceLines: IPriceLine[] = []
  let primitives: ISeriesPrimitive<Time>[] = []
  let handles = new Map<
    string,
    IPriceLine | TrendlinePrimitive | VerticalLinePrimitive | ZonePrimitive
  >()
  let highlightedId: string | null = null
  // One always-on primitive drawing every hline's minimal name label (created per attach —
  // it lives on the series and dies with it, like the other primitives).
  let labelsPrimitive: HlineLabelsPrimitive | null = null

  const syncLabels = () => {
    labelsPrimitive?.setLabels(
      drawings.flatMap((d) => {
        if (d.kind !== 'hline') return []
        const text = drawingTitle(d.label)
        return text ? [{ price: d.price, text, color: d.color ?? DEFAULT_DRAWING_COLOR }] : []
      }),
    )
  }

  // try/catch throughout: clearing must survive any teardown order (chart already removed).
  const clear = () => {
    if (series) {
      for (const line of priceLines) {
        try {
          series.removePriceLine(line)
        } catch {
          /* series already gone */
        }
      }
      for (const primitive of primitives) {
        try {
          series.detachPrimitive(primitive)
        } catch {
          /* series already gone */
        }
      }
    }
    priceLines = []
    primitives = []
    handles = new Map()
  }

  const render = () => {
    if (!series) return
    for (const d of drawings) {
      switch (d.kind) {
        case 'hline':
          {
            const line = series.createPriceLine({
              id: `drawing:${d.id}`,
              price: d.price,
              color: restingColor(d.color ?? DEFAULT_DRAWING_COLOR),
              lineWidth: 1,
              lineStyle: lineStyleOf(d.lineStyle),
              // The axis price pill appears only on hover/selection (see `highlight`); the
              // NAME is always visible but drawn by our own labels primitive at the pane's
              // left edge — tiny and quiet, not the library's axis-side title.
              axisLabelVisible: false,
              title: '',
            })
            priceLines.push(line)
            handles.set(d.id, line)
          }
          break
        case 'trendline': {
          const primitive = new TrendlinePrimitive(d)
          series.attachPrimitive(primitive)
          primitives.push(primitive)
          handles.set(d.id, primitive)
          break
        }
        case 'vline': {
          const primitive = new VerticalLinePrimitive(d)
          series.attachPrimitive(primitive)
          primitives.push(primitive)
          handles.set(d.id, primitive)
          break
        }
        case 'zone': {
          const primitive = new ZonePrimitive(d)
          series.attachPrimitive(primitive)
          primitives.push(primitive)
          handles.set(d.id, primitive)
          break
        }
        case 'marker':
          // Trade markers are NOT layer objects: they render through lightweight-charts'
          // native series-marker mini app, owned by ChartCanvas (`seriesMarkersOf`).
          break
      }
    }
  }

  return {
    attach(next) {
      series = next
      priceLines = []
      primitives = []
      labelsPrimitive = new HlineLabelsPrimitive()
      next.attachPrimitive(labelsPrimitive)
      render()
      syncLabels()
    },
    sync(next) {
      clear()
      drawings = next
      render()
      syncLabels()
      if (highlightedId) this.highlight(highlightedId)
    },
    highlight(id) {
      if (highlightedId === id) return
      if (highlightedId) {
        const previous = handles.get(highlightedId)
        const drawing = drawings.find((d) => d.id === highlightedId)
        if (
          previous instanceof TrendlinePrimitive ||
          previous instanceof VerticalLinePrimitive ||
          previous instanceof ZonePrimitive
        )
          previous.setHighlighted(false)
        else
          previous?.applyOptions({
            lineWidth: 1,
            axisLabelVisible: false,
            color: restingColor(drawing?.color ?? DEFAULT_DRAWING_COLOR),
          })
      }
      highlightedId = id
      if (!id) return
      const next = handles.get(id)
      const drawing = drawings.find((d) => d.id === id)
      if (
        next instanceof TrendlinePrimitive ||
        next instanceof VerticalLinePrimitive ||
        next instanceof ZonePrimitive
      )
        next.setHighlighted(true)
      else
        next?.applyOptions({
          lineWidth: 2,
          // Full strength + the axis price pill — the hovered level answers "where exactly".
          axisLabelVisible: true,
          color: drawing?.color ?? DEFAULT_DRAWING_COLOR,
        })
    },
    detach() {
      clear()
      labelsPrimitive = null // attached to the series being torn down; dies with it
      series = null
    },
  }
}
