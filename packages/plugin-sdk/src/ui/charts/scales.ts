// Tiny, dependency-free scale + tick helpers for the SVG charts.

export interface LinearScale {
  (v: number): number
  domain: [number, number]
  ticks(count?: number): number[]
}

/** Framework-free scale primitives used by the SDK chart renderers. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): LinearScale {
  const lo = domainMin
  let hi = domainMax
  if (lo === hi) hi = lo + 1 // avoid divide-by-zero on a flat series
  const fn = ((v: number) =>
    rangeMin + ((v - lo) / (hi - lo)) * (rangeMax - rangeMin)) as LinearScale
  fn.domain = [lo, hi]
  fn.ticks = (count = 5) => niceTicks(lo, hi, count)
  return fn
}

/** Evenly-spaced band centers for N categories within [rangeMin, rangeMax]. */
export interface BandScale {
  center(i: number): number
  bandwidth: number
  step: number
}

export function bandScale(
  count: number,
  rangeMin: number,
  rangeMax: number,
  padding = 0.2,
): BandScale {
  const span = rangeMax - rangeMin
  const step = count > 0 ? span / count : span
  const bandwidth = step * (1 - padding)
  return {
    step,
    bandwidth,
    center: (i: number) => rangeMin + step * i + step / 2,
  }
}

export function extent(values: number[]): [number, number] {
  if (values.length === 0) return [0, 1]
  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (Number.isFinite(v)) {
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1]
  return [min, max]
}

/** "Nice" rounded tick values spanning [min, max]. */
export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) return [min]
  const span = max - min
  const step0 = span / Math.max(1, count)
  const mag = Math.pow(10, Math.floor(Math.log10(step0)))
  const norm = step0 / mag
  const step = (norm >= 7.5 ? 10 : norm >= 3 ? 5 : norm >= 1.5 ? 2 : 1) * mag
  const start = Math.ceil(min / step) * step
  const ticks: number[] = []
  for (let t = start; t <= max + step * 1e-9; t += step) {
    ticks.push(Number(t.toFixed(10)))
  }
  return ticks.length > 0 ? ticks : [min, max]
}

/** Compact numeric label (1.2k, 3.4M, …). */
export function formatTick(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 1_000) return `${(v / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}k`
  if (Number.isInteger(v)) return String(v)
  return String(Number(v.toFixed(2)))
}

/** Categorical series color — the theme-tuned --chart-1..8 tokens (per-theme retuned
 * in index.css). Returned as var() strings, so consumers must apply them via `style`
 * (fill/stroke) — var() is not valid inside SVG presentation attributes. */
export function seriesColor(i: number): string {
  return `var(--chart-${(i % 8) + 1})`
}
