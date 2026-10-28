import {
  indicatorId,
  indicatorLabel,
  parseIndicatorId,
  type IndicatorParams,
} from '../../backend/indicator-spec'
import {
  MACD_HIST_UP,
  SUPERTREND_UP,
  accumDist,
  adx,
  alma,
  ao,
  aroon,
  atr,
  coppock,
  kst,
  bbPercent,
  bbWidth,
  bollinger,
  cci,
  chop,
  cmf,
  cmo,
  williamsR,
  trix,
  dema,
  donchian,
  dpo,
  easeOfMovement,
  envelopes,
  fisher,
  forceIndex,
  historicalVol,
  klinger,
  hma,
  ichimoku,
  keltner,
  lsma,
  macd,
  obv,
  pivotSeries,
  stoch,
  supertrend,
  vwap,
  vwapBands,
  type IndicatorSpec,
} from './indicators'
import type { Candle } from '../../backend/contracts'
import { emaStepper, incrementalLine, rsiStepper, smaStepper } from './indicatorIncremental'

/**
 * The PARAMETERIZED indicator catalog: any `IndicatorParams` (parsed from a canonical id like
 * `ema:200` — see backend/indicator-spec.ts, the grammar shared with the manage_chart tool)
 * becomes a drawable {@link IndicatorSpec}. The fixed menu presets are just six well-known
 * parameterizations.
 */

/** Fixed accents for the menu presets — the exact colors the chart always used. */
const PRESET_COLORS: Record<string, string> = {
  'sma:20': '#6aa8ff',
  'sma:50': '#f0a13a',
  'ema:20': '#c084fc',
}

/** Distinct-on-both-themes accents handed to NON-preset parameterizations, by a stable hash.
 *  Exported as the color-override swatch row the indicator settings popover offers. */
export const PALETTE = ['#6aa8ff', '#f0a13a', '#c084fc', '#4dd0a1', '#f472b6', '#facc15']

function lineColor(id: string): string {
  const preset = PRESET_COLORS[id]
  if (preset) return preset
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return PALETTE[Math.abs(hash) % PALETTE.length]!
}

/** The shared Donchian/Keltner shape: a neutral basis + band pair with a quiet band fill. */
function channelSpec(
  id: string,
  label: string,
  compute: (
    c: Parameters<IndicatorSpec['compute']>[0],
  ) => Pick<ReturnType<typeof donchian>, 'basis' | 'upper' | 'lower'>,
): IndicatorSpec {
  return {
    id,
    label,
    placement: 'overlay',
    series: [
      { key: 'basis', type: 'line', color: '#8b8fa3' },
      { key: 'upper', type: 'line', color: '#8b8fa366' },
      { key: 'lower', type: 'line', color: '#8b8fa366' },
    ],
    fill: { a: 'upper', b: 'lower', up: '#8b8fa314' },
    compute: (c) => {
      const { basis, upper, lower } = compute(c)
      return { basis, upper, lower }
    },
  }
}

/**
 * The drawable spec for one parameterization — or null for `volume`, which is built into the
 * chart itself (always drawn in pane 0); a caller adding it has nothing to add.
 */
export function indicatorSpecFor(params: IndicatorParams): IndicatorSpec | null {
  const id = indicatorId(params)
  const label = indicatorLabel(params)
  switch (params.kind) {
    case 'sma': {
      // Incremental: a live tick recomputes only the tail (bit-identical to `movingAverage`).
      const line = incrementalLine(smaStepper(params.period))
      return {
        id,
        label,
        placement: 'overlay',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: line(c) }),
      }
    }
    case 'ema':
    case 'hma':
    case 'dema':
    case 'alma':
    case 'lsma': {
      const { kind, period } = params
      // EMA carries its state across ticks; the window-composed averages recompute in full.
      const fn =
        kind === 'ema'
          ? incrementalLine(emaStepper(period))
          : (c: Candle[]) => ({ hma, dema, alma, lsma })[kind](c, period)
      return {
        id,
        label,
        placement: 'overlay',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: fn(c) }),
      }
    }
    case 'bollinger': {
      const { period, stdDev } = params
      return {
        id,
        label,
        placement: 'overlay',
        series: [
          { key: 'basis', type: 'line', color: '#8b8fa3' },
          { key: 'upper', type: 'line', color: '#8b8fa366' },
          { key: 'lower', type: 'line', color: '#8b8fa366' },
        ],
        fill: { a: 'upper', b: 'lower', up: '#8b8fa314' },
        compute: (c) => {
          const { basis, upper, lower } = bollinger(c, period, stdDev)
          return { basis, upper, lower }
        },
      }
    }
    case 'donchian': {
      const { period } = params
      return channelSpec(id, label, (c) => donchian(c, period))
    }
    case 'keltner': {
      const { period, mult } = params
      return channelSpec(id, label, (c) => keltner(c, period, mult))
    }
    case 'envelope': {
      const { period, pct } = params
      return channelSpec(id, label, (c) => envelopes(c, period, pct))
    }
    case 'ichimoku': {
      const { tenkan, kijun, senkou } = params
      return {
        id,
        label,
        placement: 'overlay',
        series: [
          { key: 'tenkan', type: 'line', color: '#6aa8ff' },
          { key: 'kijun', type: 'line', color: '#f472b6' },
          { key: 'spanA', type: 'line', color: '#26a69a99' },
          { key: 'spanB', type: 'line', color: '#ef535099' },
          { key: 'chikou', type: 'line', color: '#8b8fa3' },
        ],
        // The cloud: green where span A leads, red where span B does.
        fill: { a: 'spanA', b: 'spanB', up: '#26a69a1f', down: '#ef53501f' },
        compute: (c) => {
          const { tenkan: tk, kijun: kj, spanA, spanB, chikou } = ichimoku(c, tenkan, kijun, senkou)
          return { tenkan: tk, kijun: kj, spanA, spanB, chikou }
        },
      }
    }
    case 'rsi': {
      const line = incrementalLine(rsiStepper(params.period))
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: '#6aa8ff' }],
        levels: [30, 70],
        defaultRange: { min: 0, max: 100 },
        compute: (c) => ({ line: line(c) }),
      }
    }
    case 'vwap':
      return {
        id,
        label,
        placement: 'overlay',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: vwap(c) }),
      }
    case 'vwapband':
      return {
        id,
        label,
        placement: 'overlay',
        series: [
          { key: 'basis', type: 'line', color: '#c084fc' },
          { key: 'upper', type: 'line', color: '#c084fc66' },
          { key: 'lower', type: 'line', color: '#c084fc66' },
        ],
        fill: { a: 'upper', b: 'lower', up: '#c084fc14' },
        compute: (c) => {
          const { basis, upper, lower } = vwapBands(c, 2)
          return { basis, upper, lower }
        },
      }
    case 'pivots':
      return {
        id,
        label,
        placement: 'overlay',
        // Stepped: each level holds flat across a session and jumps at the UTC-day boundary.
        series: [
          { key: 'r2', type: 'line', color: '#f472b666', stepped: true },
          { key: 'r1', type: 'line', color: '#f472b6', stepped: true },
          { key: 'pp', type: 'line', color: '#8b8fa3', stepped: true, lineWidth: 2 },
          { key: 's1', type: 'line', color: '#4dd0a1', stepped: true },
          { key: 's2', type: 'line', color: '#4dd0a166', stepped: true },
        ],
        compute: (c) => {
          const { pp, r1, r2, s1, s2 } = pivotSeries(c)
          return { pp, r1, r2, s1, s2 }
        },
      }
    case 'supertrend': {
      const { period, mult } = params
      return {
        id,
        label,
        placement: 'overlay',
        // The per-point up/down tint comes from the data (`LineData.color`); the declared
        // color is the fallback + the swatch the legend/menu shows.
        series: [{ key: 'line', type: 'line', color: SUPERTREND_UP, lineWidth: 2 }],
        compute: (c) => ({ line: supertrend(c, period, mult) }),
      }
    }
    case 'stoch': {
      const { k, kSmooth, d } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [
          { key: 'k', type: 'line', color: '#6aa8ff' },
          { key: 'd', type: 'line', color: '#f0a13a' },
        ],
        levels: [20, 80],
        defaultRange: { min: 0, max: 100 },
        compute: (c) => {
          const { k: kLine, d: dLine } = stoch(c, k, kSmooth, d)
          return { k: kLine, d: dLine }
        },
      }
    }
    case 'atr': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: atr(c, period) }),
      }
    }
    case 'hv': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: historicalVol(c, period) }),
      }
    }
    case 'obv':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        valueFormat: 'volume',
        compute: (c) => ({ line: obv(c) }),
      }
    case 'ad':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        valueFormat: 'volume',
        compute: (c) => ({ line: accumDist(c) }),
      }
    case 'klinger':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        valueFormat: 'volume',
        compute: (c) => ({ line: klinger(c) }),
      }
    case 'eom': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: easeOfMovement(c, period) }),
      }
    }
    case 'adx': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [
          { key: 'adx', type: 'line', color: '#c084fc', lineWidth: 2 },
          { key: 'plusDi', type: 'line', color: '#4dd0a1' },
          { key: 'minusDi', type: 'line', color: '#f472b6' },
        ],
        levels: [25],
        compute: (c) => {
          const { adx: line, plusDi, minusDi } = adx(c, period)
          return { adx: line, plusDi, minusDi }
        },
      }
    }
    case 'macd': {
      const { fast, slow, signal } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [
          // Histogram first so the lines draw over it.
          { key: 'histogram', type: 'histogram', color: MACD_HIST_UP },
          { key: 'macd', type: 'line', color: '#6aa8ff' },
          { key: 'signal', type: 'line', color: '#f0a13a' },
        ],
        compute: (c) => {
          const { macd: line, signal: sig, histogram } = macd(c, fast, slow, signal)
          return { macd: line, signal: sig, histogram }
        },
      }
    }
    case 'cci': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [-100, 100],
        compute: (c) => ({ line: cci(c, period) }),
      }
    }
    case 'cmo': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [-50, 50],
        defaultRange: { min: -100, max: 100 },
        compute: (c) => ({ line: cmo(c, period) }),
      }
    }
    case 'williamsr': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [-20, -80],
        defaultRange: { min: -100, max: 0 },
        compute: (c) => ({ line: williamsR(c, period) }),
      }
    }
    case 'trix': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: trix(c, period) }),
      }
    }
    case 'cmf': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: cmf(c, period) }),
      }
    }
    case 'efi': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        valueFormat: 'volume',
        compute: (c) => ({ line: forceIndex(c, period) }),
      }
    }
    case 'dpo': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: dpo(c, period) }),
      }
    }
    case 'fisher': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: fisher(c, period) }),
      }
    }
    case 'chop': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [38.2, 61.8],
        defaultRange: { min: 0, max: 100 },
        compute: (c) => ({ line: chop(c, period) }),
      }
    }
    case 'aroon': {
      const { period } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [
          { key: 'up', type: 'line', color: '#4dd0a1' },
          { key: 'down', type: 'line', color: '#f472b6' },
        ],
        defaultRange: { min: 0, max: 100 },
        compute: (c) => {
          const { up, down } = aroon(c, period)
          return { up, down }
        },
      }
    }
    case 'ao':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'histogram', type: 'histogram', color: '#26a69a99' }],
        levels: [0],
        compute: (c) => ({ histogram: ao(c) }),
      }
    case 'coppock':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: coppock(c) }),
      }
    case 'kst':
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0],
        compute: (c) => ({ line: kst(c) }),
      }
    case 'bbw': {
      const { period, stdDev } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        compute: (c) => ({ line: bbWidth(c, period, stdDev) }),
      }
    }
    case 'bbpct': {
      const { period, stdDev } = params
      return {
        id,
        label,
        placement: 'pane',
        series: [{ key: 'line', type: 'line', color: lineColor(id) }],
        levels: [0, 100],
        compute: (c) => ({ line: bbPercent(c, period, stdDev) }),
      }
    }
    case 'volume':
      return null
  }
}

/** The menu presets — the full catalog at its default parameterizations, overlays then panes. */
const PRESET_PARAMS: IndicatorParams[] = [
  { kind: 'sma', period: 20 },
  { kind: 'sma', period: 50 },
  { kind: 'ema', period: 20 },
  { kind: 'hma', period: 9 },
  { kind: 'dema', period: 20 },
  { kind: 'alma', period: 9 },
  { kind: 'lsma', period: 25 },
  { kind: 'bollinger', period: 20, stdDev: 2 },
  { kind: 'keltner', period: 20, mult: 2 },
  { kind: 'envelope', period: 20, pct: 2.5 },
  { kind: 'donchian', period: 20 },
  { kind: 'ichimoku', tenkan: 9, kijun: 26, senkou: 52 },
  { kind: 'vwap' },
  { kind: 'vwapband' },
  { kind: 'pivots' },
  { kind: 'supertrend', period: 10, mult: 3 },
  { kind: 'rsi', period: 14 },
  { kind: 'macd', fast: 12, slow: 26, signal: 9 },
  { kind: 'stoch', k: 14, kSmooth: 3, d: 3 },
  { kind: 'cci', period: 20 },
  { kind: 'cmo', period: 14 },
  { kind: 'williamsr', period: 14 },
  { kind: 'trix', period: 15 },
  { kind: 'dpo', period: 20 },
  { kind: 'fisher', period: 9 },
  { kind: 'coppock' },
  { kind: 'kst' },
  { kind: 'ao' },
  { kind: 'aroon', period: 14 },
  { kind: 'atr', period: 14 },
  { kind: 'hv', period: 20 },
  { kind: 'chop', period: 14 },
  { kind: 'cmf', period: 20 },
  { kind: 'obv' },
  { kind: 'ad' },
  { kind: 'klinger' },
  { kind: 'eom', period: 14 },
  { kind: 'efi', period: 13 },
  { kind: 'adx', period: 14 },
  { kind: 'bbw', period: 20, stdDev: 2 },
  { kind: 'bbpct', period: 20, stdDev: 2 },
]

/** The preset catalog (overlays first, panes after) — what the indicator menu lists. */
export const INDICATORS: readonly IndicatorSpec[] = PRESET_PARAMS.map((p) => indicatorSpecFor(p)!)

/**
 * Resolve an active-id set into drawable specs, in a DETERMINISTIC order: overlays first (they
 * share the price scale), panes after, alphabetical within each — so pane indices are dense and
 * stable regardless of the order ids were toggled or commanded in. Unparseable ids and `volume`
 * (built-in) resolve to nothing.
 */
export function resolveIndicators(active: ReadonlySet<string>): IndicatorSpec[] {
  const specs: IndicatorSpec[] = []
  for (const id of active) {
    const params = parseIndicatorId(id)
    const spec = params ? indicatorSpecFor(params) : null
    if (spec) specs.push(spec)
  }
  return specs.sort((a, b) =>
    a.placement === b.placement ? a.id.localeCompare(b.id) : a.placement === 'overlay' ? -1 : 1,
  )
}

/**
 * The active set + its per-indicator overrides live in `indicatorPrefs.ts` (v2 records on the
 * same storage key, with the total version-free migration). This module stays what its name
 * says: the params → drawable-spec catalog. The id-set views that used to sit here — load /
 * save / migrate / toggle / applyCommand — were a second, thinner API over the same prefs, and
 * every caller now speaks the record vocabulary, so they are gone rather than kept as a shim.
 */
