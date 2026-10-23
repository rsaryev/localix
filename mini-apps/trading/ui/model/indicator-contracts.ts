import type { HistogramData, LineData } from 'lightweight-charts'
import type { Candle } from '../../backend/contracts'
/**
 * What an indicator IS, to the chart that draws it.
 *
 * A spec names its series, how each is rendered, and one `compute` that turns candles into
 * points. Nothing here computes anything — that is the whole point of the separation: the chart
 * imports this and never learns what an RSI is.
 */

export type IndicatorPoint = LineData | HistogramData

export interface IndicatorSeriesSpec {
  /** Key into the `compute()` result — `basis`, `signal`, … Unique within the indicator. */
  key: string
  type: 'line' | 'histogram'
  color: string
  lineWidth?: 1 | 2
  /** Draw as a STEP line (horizontal within a value, vertical at a jump) — pivot levels that hold
   *  flat across a session and step at the day boundary read correctly only this way. */
  stepped?: boolean
}

export interface IndicatorSpec {
  id: string
  /** Menu label — names the parameters, so the reader knows what they toggled. */
  label: string
  /** Where it draws: on the price scale, or in its own pane below the chart. */
  placement: 'overlay' | 'pane'
  series: IndicatorSeriesSpec[]
  /** Dashed reference levels drawn on the FIRST series' scale (RSI's 30/70). */
  levels?: number[]
  /**
   * The pane's NATURAL fixed range (RSI/Stoch are 0–100 by construction): applied as the
   * default autoscale range so the levels sit still while data wiggles. A user/agent range
   * override (prefs) wins over it; `auto` clears both.
   */
  defaultRange?: { min: number; max: number }
  /** How the axis formats values: prices (default) or compact volume (OBV). */
  valueFormat?: 'price' | 'volume'
  /**
   * Shade the region between two of this indicator's LINE series (Bollinger/Keltner/Donchian
   * bands, the Ichimoku cloud). `up` fills where a ≥ b; `down` (when given) fills a < b —
   * omitted, `up` fills the whole band. Drawn by a series primitive behind the lines.
   */
  fill?: { a: string; b: string; up: string; down?: string }
  compute: (candles: Candle[]) => Record<string, IndicatorPoint[]>
}
