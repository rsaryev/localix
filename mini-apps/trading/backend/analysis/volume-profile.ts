/**
 * VOLUME PROFILE — where the volume actually traded, by PRICE rather than by time. Binning the
 * window's volume across price reveals the Point of Control (POC, the most-traded price — the
 * strongest magnet) and the Value Area (the band holding ~70% of volume — where the market agreed
 * on fair value). Its edges (VAH/VAL) are support/resistance drawn from real participation, not
 * geometry, so they complement the pivot/fib/round levels the rest of the scan reads. Pure counting.
 */
import type { Candle } from '../contracts'
import { toolNumber } from '../tool-number'

export interface VolumeProfile {
  /** Point of Control — the price (bin center) with the most traded volume. */
  poc: number
  /** Value-Area High / Low — the band around the POC holding ~`valueAreaPct` of total volume. */
  vah: number
  val: number
  /** Fraction of total volume inside [val, vah] (≈ the target, exact to bin granularity). */
  valueAreaPct: number
}

const VALUE_AREA_TARGET = 0.7

/**
 * The volume profile of the window, or null when there is too little to bin (fewer than `minBars`
 * candles or a flat price range). Each candle's volume is spread evenly across the price bins its
 * high–low range spans; `bins` sets the resolution.
 */
export function volumeProfile(candles: Candle[], bins = 24, minBars = 10): VolumeProfile | null {
  if (candles.length < minBars) return null
  let min = Infinity
  let max = -Infinity
  for (const c of candles) {
    if (c.low < min) min = c.low
    if (c.high > max) max = c.high
  }
  if (!(max > min)) return null
  const width = (max - min) / bins
  const vol = Array.from({ length: bins }, () => 0)
  const binOf = (price: number) =>
    Math.min(bins - 1, Math.max(0, Math.floor((price - min) / width)))
  for (const c of candles) {
    const lo = binOf(c.low)
    const hi = binOf(c.high)
    const share = (c.volume ?? 0) / (hi - lo + 1)
    for (let b = lo; b <= hi; b++) vol[b] += share
  }
  const total = vol.reduce((s, v) => s + v, 0)
  if (!(total > 0)) return null
  // POC — the fullest bin.
  let poc = 0
  for (let b = 1; b < bins; b++) if (vol[b]! > vol[poc]!) poc = b
  // Value area: grow out from the POC, each step taking the heavier adjacent bin, until ~70%.
  let lo = poc
  let hi = poc
  let acc = vol[poc]!
  const target = total * VALUE_AREA_TARGET
  while (acc < target && (lo > 0 || hi < bins - 1)) {
    const up = hi < bins - 1 ? vol[hi + 1]! : -1
    const down = lo > 0 ? vol[lo - 1]! : -1
    if (up >= down) acc += vol[++hi]!
    else acc += vol[--lo]!
  }
  const center = (b: number) => min + (b + 0.5) * width
  return {
    poc: center(poc),
    vah: min + (hi + 1) * width,
    val: min + lo * width,
    valueAreaPct: acc / total,
  }
}

/** Four significant digits without exponent noise (the house tool-number rule). */
/** Where `price` sits relative to a value area: premium (above VAH — richly priced), discount
 *  (below VAL — cheap), or fair (inside). */
export function valueAreaPosition(
  vp: VolumeProfile,
  price: number,
): 'premium' | 'fair' | 'discount' {
  return price > vp.vah ? 'premium' : price < vp.val ? 'discount' : 'fair'
}

/** The profile as one report line, or nothing when it could not be built. When `price` is given,
 *  the line also states whether price is at a premium / discount / fair value vs the area. */
export function renderVolumeProfile(vp: VolumeProfile | null, price?: number): string[] {
  if (!vp) return []
  const where =
    price !== undefined
      ? (() => {
          const pos = valueAreaPosition(vp, price)
          return pos === 'fair'
            ? ' Price is inside the area (fair value).'
            : ` Price is at a ${pos} (${pos === 'premium' ? 'above the area — richly priced' : 'below the area — cheap'}).`
        })()
      : ''
  return [
    `- volume profile: POC ${toolNumber(vp.poc)} (most-traded price — a magnet), value area ${toolNumber(vp.val)}–${toolNumber(vp.vah)} (${Math.round(vp.valueAreaPct * 100)}% of volume — its edges are volume-based S/R).${where}`,
  ]
}
