/**
 * The PARAMETERIZED indicator grammar — the one vocabulary the agent tool (backend), the chart
 * catalog (ui/model/indicatorSpecs.ts) and the saved prefs all speak. Pure: no chart, no zod, no
 * storage, so both sides can import it without dragging the other's world in.
 *
 * Canonical string ids: `sma:20`, `ema:200`, `rsi:14`, `bb:20:2`, `macd:12:26:9`, `vwap`,
 * `supertrend:10:3`, `stoch:14:3:3`, `atr:14`, `obv`, `adx:14`, `volume`.
 * Parsing is deliberately tolerant (an agent writes `EMA 200`, `ema200`, `bollinger:20`, or
 * `bb20`), but FORMATTING is canonical — every accepted spelling round-trips to
 * exactly one id, so a set of active indicators can never hold the same line twice under two names.
 */

/** Kinds whose single parameter is a lookback period — one shape, one switch arm everywhere. */
export const PERIOD_KINDS = [
  'sma',
  'ema',
  'rsi',
  'atr',
  'adx',
  'hma',
  'dema',
  'alma',
  'lsma',
  'cci',
  'cmf',
  'aroon',
  'chop',
  'cmo',
  'donchian',
  'efi',
  'dpo',
  'fisher',
  'hv',
  'eom',
  'williamsr',
  'trix',
] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

/** Kinds with no parameter at all — one shape, one arm everywhere they share an answer. */
const PARAMLESS_KINDS = [
  'vwap',
  'obv',
  'volume',
  'ao',
  'vwapband',
  'pivots',
  'ad',
  'coppock',
  'kst',
  'klinger',
] as const
type ParamlessKind = (typeof PARAMLESS_KINDS)[number]

const PERIOD_KIND_SET: ReadonlySet<string> = new Set(PERIOD_KINDS)
const PARAMLESS_KIND_SET: ReadonlySet<string> = new Set(PARAMLESS_KINDS)

export type IndicatorParams =
  | { kind: PeriodKind; period: number }
  /** `bbw`/`bbpct` are Bollinger DERIVATIVES (width / %B) — same two parameters, own panes. */
  | { kind: 'bollinger' | 'bbw' | 'bbpct'; period: number; stdDev: number }
  /** Keltner Channels: EMA(period) basis ± ATR(period)·mult. */
  | { kind: 'keltner'; period: number; mult: number }
  /** Envelopes: SMA(period) basis ± a fixed `pct` percent. */
  | { kind: 'envelope'; period: number; pct: number }
  /** Ichimoku Cloud: tenkan/kijun/senkou-B lookbacks (kijun is also the cloud shift). */
  | { kind: 'ichimoku'; tenkan: number; kijun: number; senkou: number }
  /** Awesome Oscillator — fixed 5/34 median-price SMAs by definition, so parameterless. */
  | { kind: 'ao' }
  /** Session VWAP σ-bands — daily VWAP ± 2σ (fixed), so parameterless like VWAP itself. */
  | { kind: 'vwapband' }
  /** Classic daily pivot points (PP/R1/R2/S1/S2 from the prior day) — parameterless. */
  | { kind: 'pivots' }
  /** Accumulation/Distribution line — cumulative, parameterless like OBV. */
  | { kind: 'ad' }
  /** Coppock Curve — WMA(10) of ROC(14)+ROC(11), fixed periods so parameterless. */
  | { kind: 'coppock' }
  /** Know Sure Thing — weighted sum of four smoothed ROCs, fixed periods so parameterless. */
  | { kind: 'kst' }
  /** Klinger Volume Oscillator — volume-force EMA(34)−EMA(55), fixed periods so parameterless. */
  | { kind: 'klinger' }
  | { kind: 'macd'; fast: number; slow: number; signal: number }
  /** SuperTrend: an ATR(period) band multiplied by `mult`; `mult` may be fractional (e.g. 2.5). */
  | { kind: 'supertrend'; period: number; mult: number }
  /** Stochastic %K/%D: `k` lookback, `kSmooth` %K smoothing, `d` %D period. */
  | { kind: 'stoch'; k: number; kSmooth: number; d: number }
  /** Session VWAP, anchored to the UTC day — parameterless (crypto's only unambiguous session). */
  | { kind: 'vwap' }
  /** On-balance volume — parameterless cumulative sum. */
  | { kind: 'obv' }
  /** Volume is built into the chart itself (always drawn); accepted so an agent asking for it is
   *  answered honestly instead of rejected. */
  | { kind: 'volume' }

export type IndicatorKind = IndicatorParams['kind']

/** Narrows to the one-period shape, so a switch keeps only the kinds with an arm of their own. */
function isPeriodParams(p: IndicatorParams): p is Extract<IndicatorParams, { kind: PeriodKind }> {
  return PERIOD_KIND_SET.has(p.kind)
}

/** Narrows to the parameterless shapes, for the functions that answer them all alike. */
function isParamlessParams(
  p: IndicatorParams,
): p is Extract<IndicatorParams, { kind: ParamlessKind }> {
  return PARAMLESS_KIND_SET.has(p.kind)
}

/** Defaults used when a spelling names a kind but not (all of) its parameters. */
const DEFAULTS = {
  sma: { period: 20 },
  ema: { period: 20 },
  rsi: { period: 14 },
  atr: { period: 14 },
  adx: { period: 14 },
  hma: { period: 9 },
  dema: { period: 20 },
  alma: { period: 9 },
  lsma: { period: 25 },
  cci: { period: 20 },
  cmf: { period: 20 },
  aroon: { period: 14 },
  chop: { period: 14 },
  cmo: { period: 14 },
  donchian: { period: 20 },
  efi: { period: 13 },
  dpo: { period: 20 },
  fisher: { period: 9 },
  hv: { period: 20 },
  eom: { period: 14 },
  williamsr: { period: 14 },
  trix: { period: 15 },
  bollinger: { period: 20, stdDev: 2 },
  bbw: { period: 20, stdDev: 2 },
  bbpct: { period: 20, stdDev: 2 },
  keltner: { period: 20, mult: 2 },
  envelope: { period: 20, pct: 2.5 },
  macd: { fast: 12, slow: 26, signal: 9 },
  supertrend: { period: 10, mult: 3 },
  stoch: { k: 14, kSmooth: 3, d: 3 },
  ichimoku: { tenkan: 9, kijun: 26, senkou: 52 },
} as const

/** Kind spellings → canonical kind. `bb` is the canonical token for `bollinger`. */
const KIND_ALIASES: Record<string, IndicatorKind> = {
  sma: 'sma',
  ema: 'ema',
  rsi: 'rsi',
  bb: 'bollinger',
  boll: 'bollinger',
  bollinger: 'bollinger',
  macd: 'macd',
  vwap: 'vwap',
  supertrend: 'supertrend',
  st: 'supertrend',
  stoch: 'stoch',
  stochastic: 'stoch',
  stochastics: 'stoch',
  atr: 'atr',
  obv: 'obv',
  adx: 'adx',
  dmi: 'adx',
  volume: 'volume',
  vol: 'volume',
  hma: 'hma',
  hull: 'hma',
  dema: 'dema',
  alma: 'alma',
  lsma: 'lsma',
  linreg: 'lsma',
  cci: 'cci',
  cmf: 'cmf',
  aroon: 'aroon',
  chop: 'chop',
  choppiness: 'chop',
  cmo: 'cmo',
  chande: 'cmo',
  donchian: 'donchian',
  dc: 'donchian',
  efi: 'efi',
  force: 'efi',
  forceindex: 'efi',
  dpo: 'dpo',
  fisher: 'fisher',
  hv: 'hv',
  histvol: 'hv',
  volatility: 'hv',
  eom: 'eom',
  emv: 'eom',
  williamsr: 'williamsr',
  williams: 'williamsr',
  wpr: 'williamsr',
  willr: 'williamsr',
  trix: 'trix',
  bbw: 'bbw',
  bbwidth: 'bbw',
  bbpct: 'bbpct',
  bbb: 'bbpct',
  percentb: 'bbpct',
  keltner: 'keltner',
  kc: 'keltner',
  envelope: 'envelope',
  envelopes: 'envelope',
  env: 'envelope',
  ao: 'ao',
  awesome: 'ao',
  vwapband: 'vwapband',
  vwapbands: 'vwapband',
  vwb: 'vwapband',
  pivots: 'pivots',
  pivot: 'pivots',
  pp: 'pivots',
  ad: 'ad',
  adl: 'ad',
  accdist: 'ad',
  coppock: 'coppock',
  kst: 'kst',
  klinger: 'klinger',
  kvo: 'klinger',
  ichimoku: 'ichimoku',
  ichi: 'ichimoku',
  cloud: 'ichimoku',
}

/**
 * Every accepted spelling for a kind EXCEPT its canonical token — the alias words a user might
 * type to find it (`hull` for hma, `kc` for keltner, `force` for efi). Powers the indicator
 * picker's search so a trader need not know the canonical id. Derived from {@link KIND_ALIASES},
 * so a new alias is searchable the moment it is added.
 */
export function indicatorAliases(kind: IndicatorKind): string[] {
  const aliases: string[] = []
  for (const [spelling, aliasKind] of Object.entries(KIND_ALIASES)) {
    if (aliasKind === kind && spelling !== kind) aliases.push(spelling)
  }
  return aliases
}

const intIn = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max
const period = (n: number) => intIn(n, 1, 500)

/** Validate a parsed candidate; null when a parameter is out of range or inconsistent. */
export function validIndicatorParams(p: IndicatorParams): IndicatorParams | null {
  if (isPeriodParams(p)) return period(p.period) ? p : null
  if (isParamlessParams(p)) return p
  switch (p.kind) {
    case 'bollinger':
    case 'bbw':
    case 'bbpct':
      return period(p.period) && p.stdDev > 0 && p.stdDev <= 10 ? p : null
    case 'macd':
      return period(p.fast) && period(p.slow) && period(p.signal) && p.fast < p.slow ? p : null
    case 'supertrend':
    case 'keltner':
      return period(p.period) && p.mult > 0 && p.mult <= 10 ? p : null
    case 'envelope':
      return period(p.period) && p.pct > 0 && p.pct <= 50 ? p : null
    case 'stoch':
      return period(p.k) && period(p.kSmooth) && period(p.d) ? p : null
    case 'ichimoku':
      return period(p.tenkan) && period(p.kijun) && period(p.senkou) && p.tenkan <= p.kijun
        ? p
        : null
  }
}

/**
 * Parse ANY accepted spelling into validated params, or null. Accepted forms per kind:
 * canonical (`ema:200`), spaced/joined (`ema 200`, `ema200`, `ema-200`), bare kind with defaults
 * (`macd`, `bollinger`), and the joined forms (`sma20`, `ema20`, `bb20`, `rsi14`).
 */
export function parseIndicatorId(raw: string): IndicatorParams | null {
  const text = raw.trim().toLowerCase()
  if (text.length === 0 || text.length > 64) return null
  // Split `kind` from its numeric params on `:`, whitespace, `-`, `_`, `,` or nothing (`ema200`).
  const m = text.match(/^([a-z]+)\s*[:\s,_-]*\s*([\d.:,\s_-]*)$/)
  if (!m) return null
  const kind = KIND_ALIASES[m[1]!]
  if (!kind) return null
  const nums = (m[2] ?? '')
    .split(/[:\s,_-]+/)
    .filter((s) => s.length > 0)
    .map(Number)
  if (nums.some((n) => !Number.isFinite(n))) return null

  // Parameterless kinds reject numerals — `vwap:20` names a parameter that does not exist,
  // and inventing a meaning for it would be a silent lie.
  if (
    kind === 'volume' ||
    kind === 'vwap' ||
    kind === 'obv' ||
    kind === 'ao' ||
    kind === 'vwapband' ||
    kind === 'pivots' ||
    kind === 'ad' ||
    kind === 'coppock' ||
    kind === 'kst' ||
    kind === 'klinger'
  )
    return nums.length === 0 ? { kind } : null
  if (kind === 'macd') {
    if (nums.length !== 0 && nums.length !== 3) return null
    const [fast, slow, signal] = nums.length ? (nums as [number, number, number]) : ([] as never[])
    return validIndicatorParams({
      kind,
      ...DEFAULTS.macd,
      ...(nums.length ? { fast, slow, signal } : {}),
    })
  }
  if (kind === 'ichimoku') {
    if (nums.length !== 0 && nums.length !== 3) return null
    return validIndicatorParams({
      kind,
      tenkan: nums[0] ?? DEFAULTS.ichimoku.tenkan,
      kijun: nums[1] ?? DEFAULTS.ichimoku.kijun,
      senkou: nums[2] ?? DEFAULTS.ichimoku.senkou,
    })
  }
  if (kind === 'stoch') {
    if (nums.length !== 0 && nums.length !== 3) return null
    return validIndicatorParams({
      kind,
      k: nums[0] ?? DEFAULTS.stoch.k,
      kSmooth: nums[1] ?? DEFAULTS.stoch.kSmooth,
      d: nums[2] ?? DEFAULTS.stoch.d,
    })
  }
  if (kind === 'bollinger' || kind === 'bbw' || kind === 'bbpct') {
    if (nums.length > 2) return null
    return validIndicatorParams({
      kind,
      period: nums[0] ?? DEFAULTS[kind].period,
      stdDev: nums[1] ?? DEFAULTS[kind].stdDev,
    })
  }
  if (kind === 'supertrend' || kind === 'keltner') {
    if (nums.length > 2) return null
    return validIndicatorParams({
      kind,
      period: nums[0] ?? DEFAULTS[kind].period,
      mult: nums[1] ?? DEFAULTS[kind].mult,
    })
  }
  if (kind === 'envelope') {
    if (nums.length > 2) return null
    return validIndicatorParams({
      kind,
      period: nums[0] ?? DEFAULTS.envelope.period,
      pct: nums[1] ?? DEFAULTS.envelope.pct,
    })
  }
  if (nums.length > 1) return null
  return validIndicatorParams({ kind, period: nums[0] ?? DEFAULTS[kind].period })
}

/** The canonical id for a spec — the ONLY spelling stored, compared, or shown to the agent. */
export function indicatorId(p: IndicatorParams): string {
  if (isPeriodParams(p)) return `${p.kind}:${p.period}`
  if (isParamlessParams(p)) return p.kind
  switch (p.kind) {
    case 'bollinger':
      return `bb:${p.period}:${p.stdDev}`
    case 'bbw':
    case 'bbpct':
      return `${p.kind}:${p.period}:${p.stdDev}`
    case 'macd':
      return `macd:${p.fast}:${p.slow}:${p.signal}`
    case 'supertrend':
    case 'keltner':
      return `${p.kind}:${p.period}:${p.mult}`
    case 'envelope':
      return `envelope:${p.period}:${p.pct}`
    case 'stoch':
      return `stoch:${p.k}:${p.kSmooth}:${p.d}`
    case 'ichimoku':
      return `ichimoku:${p.tenkan}:${p.kijun}:${p.senkou}`
  }
}

/** Any accepted spelling → its canonical id, or null when unparseable. */
export function normalizeIndicatorId(raw: string): string | null {
  const p = parseIndicatorId(raw)
  return p ? indicatorId(p) : null
}

/**
 * The indicator's NAME, without its parameters — the stable half of every label. Split out because
 * the legend edits the two halves separately: the name is a caption, the parameters are fields.
 */
export function indicatorKindLabel(kind: IndicatorKind): string {
  switch (kind) {
    case 'bollinger':
      return 'Bollinger'
    case 'bbw':
      return 'BB Width'
    case 'bbpct':
      return 'BB %B'
    case 'macd':
      return 'MACD'
    case 'supertrend':
      return 'SuperTrend'
    case 'keltner':
      return 'Keltner'
    case 'stoch':
      return 'Stoch'
    case 'ichimoku':
      return 'Ichimoku'
    case 'vwap':
      return 'VWAP'
    case 'obv':
      return 'OBV'
    case 'ao':
      return 'AO'
    case 'vwapband':
      return 'VWAP Bands'
    case 'pivots':
      return 'Pivots'
    case 'ad':
      return 'A/D'
    case 'coppock':
      return 'Coppock'
    case 'kst':
      return 'KST'
    case 'klinger':
      return 'Klinger'
    case 'volume':
      return 'Volume'
    case 'aroon':
      return 'Aroon'
    case 'chop':
      return 'Chop'
    case 'donchian':
      return 'Donchian'
    case 'efi':
      return 'Force Index'
    case 'williamsr':
      return 'Williams %R'
    case 'envelope':
      return 'Envelopes'
    case 'sma':
    case 'ema':
    case 'rsi':
    case 'atr':
    case 'adx':
    case 'hma':
    case 'dema':
    case 'alma':
    case 'lsma':
    case 'cci':
    case 'cmf':
    case 'cmo':
    case 'dpo':
    case 'fisher':
    case 'hv':
    case 'eom':
    case 'trix':
      return kind.toUpperCase()
  }
}

/**
 * The four families a trader reads by — how the indicator MENU is grouped and the vocabulary the
 * agent uses to reason about confirmation (a momentum signal confirming a trend signal is worth
 * more than two trend tools agreeing). One kind sits in exactly one family: bands are volatility,
 * ADX is trend-strength (it lives with trend), MAs/clouds are trend, OBV/CMF/volume are volume.
 */
export type IndicatorCategory = 'trend' | 'momentum' | 'volatility' | 'volume'

/** Category order + display labels — the fixed sequence the menu lists families in. */
export const INDICATOR_CATEGORIES: ReadonlyArray<{ key: IndicatorCategory; label: string }> = [
  { key: 'trend', label: 'Trend' },
  { key: 'momentum', label: 'Momentum' },
  { key: 'volatility', label: 'Volatility' },
  { key: 'volume', label: 'Volume' },
]

/** Which family a kind belongs to. Exhaustive over {@link IndicatorKind}. */
export function indicatorCategory(kind: IndicatorKind): IndicatorCategory {
  switch (kind) {
    case 'sma':
    case 'ema':
    case 'hma':
    case 'dema':
    case 'alma':
    case 'lsma':
    case 'vwap':
    case 'supertrend':
    case 'ichimoku':
    case 'adx':
    case 'pivots':
      return 'trend'
    case 'rsi':
    case 'macd':
    case 'stoch':
    case 'cci':
    case 'cmo':
    case 'ao':
    case 'aroon':
    case 'efi':
    case 'dpo':
    case 'fisher':
    case 'coppock':
    case 'kst':
    case 'williamsr':
    case 'trix':
      return 'momentum'
    case 'bollinger':
    case 'keltner':
    case 'donchian':
    case 'atr':
    case 'bbw':
    case 'bbpct':
    case 'chop':
    case 'vwapband':
    case 'envelope':
    case 'hv':
      return 'volatility'
    case 'obv':
    case 'cmf':
    case 'volume':
    case 'ad':
    case 'klinger':
    case 'eom':
      return 'volume'
  }
}

/** Human label for menus / tool results — names the parameters, so the reader knows what is on. */
export function indicatorLabel(p: IndicatorParams): string {
  const name = indicatorKindLabel(p.kind)
  if (isPeriodParams(p)) return `${name} ${p.period}`
  switch (p.kind) {
    case 'bollinger':
    case 'bbw':
    case 'bbpct':
      return `${name} (${p.period}, ${p.stdDev}σ)`
    case 'macd':
      return `${name} (${p.fast}, ${p.slow}, ${p.signal})`
    case 'supertrend':
    case 'keltner':
      return `${name} (${p.period}, ${p.mult})`
    case 'envelope':
      return `${name} (${p.period}, ${p.pct}%)`
    case 'stoch':
      return `${name} (${p.k}, ${p.kSmooth}, ${p.d})`
    case 'ichimoku':
      return `${name} (${p.tenkan}, ${p.kijun}, ${p.senkou})`
    case 'vwap':
      // Anchored to the UTC day — named so a reader on a 1d timeframe knows why it hugs price.
      return `${name} (daily)`
    case 'ao':
      // Fixed by definition; named so the reader knows which AO this is.
      return `${name} (5, 34)`
    case 'vwapband':
      // Session-anchored, fixed 2σ — named so a reader knows the anchor and the width.
      return `${name} (daily, 2σ)`
    case 'pivots':
      return `${name} (daily)`
    case 'obv':
    case 'volume':
    case 'ad':
    case 'coppock':
    case 'kst':
    case 'klinger':
      return name
  }
}

/**
 * One indicator's editable numeric fields, in canonical id order — the grammar's own account of
 * what a reader can change. Lives here rather than in the editor so the fields, the id and the
 * label cannot drift: a kind that grows a parameter grows a field.
 */
export function indicatorParamFields(p: IndicatorParams): Array<{ label: string; value: number }> {
  if (isPeriodParams(p)) return [{ label: 'Period', value: p.period }]
  if (isParamlessParams(p)) return []
  switch (p.kind) {
    case 'bollinger':
    case 'bbw':
    case 'bbpct':
      return [
        { label: 'Period', value: p.period },
        { label: 'StdDev', value: p.stdDev },
      ]
    case 'macd':
      return [
        { label: 'Fast', value: p.fast },
        { label: 'Slow', value: p.slow },
        { label: 'Signal', value: p.signal },
      ]
    case 'supertrend':
    case 'keltner':
      return [
        { label: 'Period', value: p.period },
        { label: 'Multiplier', value: p.mult },
      ]
    case 'envelope':
      return [
        { label: 'Period', value: p.period },
        { label: 'Percent', value: p.pct },
      ]
    case 'stoch':
      return [
        { label: '%K', value: p.k },
        { label: '%K smooth', value: p.kSmooth },
        { label: '%D', value: p.d },
      ]
    case 'ichimoku':
      return [
        { label: 'Tenkan', value: p.tenkan },
        { label: 'Kijun', value: p.kijun },
        { label: 'Senkou B', value: p.senkou },
      ]
  }
}

/** Rebuild params with the field at `index` replaced — the inverse of {@link indicatorParamFields}. */
export function withIndicatorParam(
  p: IndicatorParams,
  index: number,
  value: number,
): IndicatorParams {
  if (isPeriodParams(p)) return { ...p, period: value }
  if (isParamlessParams(p)) return p
  switch (p.kind) {
    case 'bollinger':
    case 'bbw':
    case 'bbpct':
      return index === 0 ? { ...p, period: value } : { ...p, stdDev: value }
    case 'macd':
      return index === 0
        ? { ...p, fast: value }
        : index === 1
          ? { ...p, slow: value }
          : { ...p, signal: value }
    case 'supertrend':
    case 'keltner':
      return index === 0 ? { ...p, period: value } : { ...p, mult: value }
    case 'envelope':
      return index === 0 ? { ...p, period: value } : { ...p, pct: value }
    case 'stoch':
      return index === 0
        ? { ...p, k: value }
        : index === 1
          ? { ...p, kSmooth: value }
          : { ...p, d: value }
    case 'ichimoku':
      return index === 0
        ? { ...p, tenkan: value }
        : index === 1
          ? { ...p, kijun: value }
          : { ...p, senkou: value }
  }
}

/** One line for a fix-it message: every accepted form, with examples. */
export const INDICATOR_FORMS =
  'sma:<period>, ema:<period>, hma:<period>, dema:<period>, alma:<period>, lsma:<period>, ' +
  'rsi:<period>, cci:<period>, cmo:<period>, williamsr:<period>, trix:<period>, cmf:<period>, aroon:<period>, chop:<period>, efi:<period>, dpo:<period>, fisher:<period>, hv:<period>, eom:<period>, coppock, kst, klinger, ' +
  'bb:<period>:<stdDev>, bbw:<period>:<stdDev>, bbpct:<period>:<stdDev>, ' +
  'donchian:<period>, keltner:<period>:<mult>, envelope:<period>:<pct>, macd:<fast>:<slow>:<signal>, ' +
  'ichimoku:<tenkan>:<kijun>:<senkouB>, vwap, supertrend:<period>:<mult>, ' +
  'stoch:<k>:<kSmooth>:<d>, atr:<period>, obv, adx:<period>, ao, vwapband, pivots, ad, volume ' +
  '(e.g. "ema:200", "bb:20:2", "supertrend:10:3", "ichimoku:9:26:52"; bare kinds take defaults; ' +
  'aliases: st=supertrend, dmi=adx, stochastic=stoch, hull=hma, kc=keltner, dc=donchian, ' +
  'cloud=ichimoku; joined forms like "sma20" work too)'
