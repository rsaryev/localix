import type { Market, PrecisionMode } from '../../backend/contracts'

/**
 * Pure quote/number formatting for the trading workbench.
 *
 * A venue reports each market's `precision`, and HOW to read it is carried by
 * `ExchangeInfo.precisionMode` — this is NOT cosmetic. The major venues (Hyperliquid,
 * Binance, Bybit) report `tick`, where `precision.price = 1` means the price steps by 1
 * (BTC quotes as `63851`), and `precision.amount = 0.00001` means the size steps by 1e-5.
 * Reading a tick as a decimal-place count would render prices wrong. So every formatter
 * branches on the mode; `tick` also snaps a PREVIEW value to the nearest increment.
 *
 * These helpers are DISPLAY ONLY. They do NOT predict what a venue will accept, and nothing here
 * may be used to preview a submission: `precision` is what the venue REPORTS, and a venue is free
 * to round by a different rule entirely. Hyperliquid reports `precision.price = 1` for BTC yet
 * accepts `1234.6` — its `priceToPrecision` rounds to 5 significant digits, not to the reported
 * tick, and its `amountToPrecision` ROUNDS where base ccxt truncates. The only thing that knows a
 * venue's rounding is the venue's own driver: ask `tradingApi.previewOrder`.
 *
 * Pure so every rule is unit-tested.
 */

const DEFAULT_PRICE_DECIMALS = 2
const DEFAULT_AMOUNT_DECIMALS = 4
const MAX_DECIMALS = 8

/** Expand a possibly-exponent number (`1e-7`) into plain fixed notation for decimal
 *  counting — `String(0.0000001)` is `'1e-7'`, which hides the decimal count. */
function toPlainString(n: number): string {
  const str = String(n)
  if (!str.includes('e') && !str.includes('E')) return str
  const decimals = Math.max(0, Math.min(20, -Math.floor(Math.log10(Math.abs(n)))))
  return n.toFixed(decimals)
}

/**
 * Decimal places implied by a TICK SIZE: `1 → 0`, `10 → 0`, `0.1 → 1`, `0.0005 → 4`,
 * `0.0000001 → 7`. A tick ≥ 1 has no fractional part. `null` for a missing / invalid tick.
 */
export function decimalsFromTick(tick: number | undefined): number | null {
  if (tick == null || !Number.isFinite(tick) || tick <= 0) return null
  if (tick >= 1) return 0
  const text = toPlainString(tick)
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : Math.min(text.length - dot - 1, MAX_DECIMALS)
}

/**
 * Decimal places to render `value` at, given a `precision` number read under `mode`:
 *  - `tick`        → decimals implied by the tick size (value-independent);
 *  - `decimals`    → the integer decimal-place count itself;
 *  - `significant` → derived per value: significant figures minus the integer digits.
 * Returns `null` when `precision` is missing/invalid so callers fall back to a default.
 */
export function decimalsForValue(
  value: number,
  precision: number | undefined,
  mode: PrecisionMode,
): number | null {
  if (precision == null || !Number.isFinite(precision) || precision < 0) return null
  if (mode === 'tick') return decimalsFromTick(precision)
  if (mode === 'decimals') return Math.min(Math.round(precision), MAX_DECIMALS)
  // significant: keep `precision` significant figures at this magnitude.
  if (value === 0) return Math.min(Math.round(precision), MAX_DECIMALS)
  const intDigits = Math.floor(Math.log10(Math.abs(value))) + 1
  return Math.max(0, Math.min(MAX_DECIMALS, Math.round(precision) - intDigits))
}

/**
 * Decimal places the value ITSELF carries. Rounded to {@link MAX_DECIMALS} first, so binary
 * float noise (a computed mid of `63982.50000000001`) reports 1 decimal, not 8.
 */
function decimalsOf(value: number): number {
  if (!Number.isFinite(value)) return 0
  const text = toPlainString(Math.abs(Number(value.toFixed(MAX_DECIMALS))))
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : Math.min(text.length - dot - 1, MAX_DECIMALS)
}

/**
 * How many decimals to render `value` at: what the venue's precision implies, but NEVER fewer than
 * the number actually carries.
 *
 * A tick is a submission increment, not a display rule, and a venue is free to quote finer than it
 * claims to step. Hyperliquid reports `precision.price = 1` for BTC and quotes `63978.9` — reading
 * the tick alone rendered the whole order book, the ticker and every price line one dollar off.
 */
function renderDecimals(
  value: number,
  precision: number | undefined,
  mode: PrecisionMode,
  fallback: number,
): number {
  const fromPrecision = decimalsForValue(value, precision, mode) ?? fallback
  return Math.min(MAX_DECIMALS, Math.max(fromPrecision, decimalsOf(value)))
}

function toLocale(value: number, decimals: number): string {
  return value.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })
}

/**
 * Render a price at an EXACT decimal count. Used by the chart's crosshair legend, which must match
 * the axis to the last digit — and the axis is driven by `chartPriceFormat().precision`, not by
 * re-deriving decimals from the market (which could disagree by a digit). `—` for a non-finite value.
 */
export function formatFixed(value: number | null | undefined, decimals: number): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return toLocale(value, Math.max(0, Math.min(MAX_DECIMALS, Math.round(decimals))))
}

/** Format a price honouring a market's price precision + the venue's precision mode. */
export function formatPrice(
  value: number | null | undefined,
  market?: Market | null,
  mode: PrecisionMode = 'tick',
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return toLocale(
    value,
    renderDecimals(value, market?.precision.price, mode, DEFAULT_PRICE_DECIMALS),
  )
}

/** Format an order/trade size honouring a market's amount precision + precision mode. */
export function formatSize(
  value: number | null | undefined,
  market?: Market | null,
  mode: PrecisionMode = 'tick',
): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const decimals = renderDecimals(value, market?.precision.amount, mode, DEFAULT_AMOUNT_DECIMALS)
  // Sizes trim trailing zeros (min 0) so a whole-lot size doesn't read `2.00000`.
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

/**
 * Format a fractional 24h change (`0.031` → `+3.10%`), always signed. `null`/non-finite
 * → an em-dash. Returns the raw string plus a sign so callers can tint up/down/flat.
 */
export function formatPercent(change: number | null | undefined): {
  text: string
  sign: -1 | 0 | 1
} {
  if (change == null || !Number.isFinite(change)) return { text: '—', sign: 0 }
  const pct = change * 100
  const sign = pct > 0 ? 1 : pct < 0 ? -1 : 0
  const prefix = sign > 0 ? '+' : ''
  return { text: `${prefix}${pct.toFixed(2)}%`, sign }
}

/** Compact a large volume for a tight header cell: 1.2K / 3.4M / 5.6B / 7.8T. */
export function formatCompactVolume(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  const units: Array<[number, string]> = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'K'],
  ]
  for (const [scale, suffix] of units) {
    if (abs >= scale) return `${(value / scale).toFixed(2)}${suffix}`
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

/** What lightweight-charts needs to render a price axis, crosshair and price line. */
export interface ChartPriceFormat {
  precision: number
  minMove: number
}

/**
 * Decimals actually present in a number (`63982.5` → 1, `0.074026` → 6), bounded.
 * Exponent notation is expanded first: `String(1e-7)` is `'1e-7'`, which hides the decimals.
 */

/**
 * The price format for the chart's candle series. lightweight-charts defaults to
 * `{ precision: 2, minMove: 0.01 }` and we never overrode it, so every market rendered at two
 * decimals: DOGE at `0.074026` became a flat `0.07` on the axis, the crosshair and every price
 * line, even though its tick is `0.000001`.
 *
 * Decimals come from the venue's reported precision — but never FEWER than the prices actually
 * carry. Hyperliquid reports `precision.price = 1` for BTC and quotes `63982.5`; a tick-derived 0
 * would hide every half-dollar move on the chart.
 *
 * `prices` should be a STABLE sample (the loaded candle closes), not the live last trade: a price
 * oscillating between `63982` and `63982.5` would otherwise flip the axis between 0 and 1 decimals
 * on every tick.
 *
 * `minMove` is `10^-precision`, the smallest step the axis will label.
 */
export function chartPriceFormat(
  market: Market | null | undefined,
  mode: PrecisionMode,
  prices: readonly number[] = [],
): ChartPriceFormat {
  const magnitude = prices.find((p) => Number.isFinite(p) && p !== 0) ?? 1
  const fromTick =
    decimalsForValue(magnitude, market?.precision.price, mode) ?? DEFAULT_PRICE_DECIMALS
  const fromPrices = prices.reduce((max, p) => Math.max(max, decimalsOf(p)), 0)
  const precision = Math.min(MAX_DECIMALS, Math.max(fromTick, fromPrices))
  return { precision, minMove: Number((10 ** -precision).toFixed(MAX_DECIMALS)) }
}

/**
 * A funding rate as a percentage of position value, per the venue's OWN period.
 *
 * The period is never assumed. Hyperliquid funds hourly, most venues every eight hours, so `0.00125%`
 * without a period is not a number anyone can act on — and multiplying it into a daily or annual
 * figure would be wrong by whatever factor the venue's period differs by. When the venue reports no
 * interval we say so rather than pick one.
 */
export function formatFundingRate(rate: number, interval?: string): string {
  const pct = trimZeros((rate * 100).toFixed(5))
  const signed = rate > 0 ? `+${pct}` : pct
  return `${signed}% / ${interval ?? '?'}`
}

/** Drop trailing zeros a fixed-decimal string leaves behind: `0.00125` not `0.00125000`. */
function trimZeros(text: string): string {
  return text.includes('.') ? text.replace(/0+$/, '').replace(/\.$/, '') : text
}

// The funding countdown is the SAME formatter the agent's market_data tool prints, so the human chart
// header and the agent never render a settlement time differently. It lives in backend/ (importable by
// both); re-exported here so existing UI imports of formatQuote are unchanged.
export { formatCountdown } from '../../backend/time-format'
