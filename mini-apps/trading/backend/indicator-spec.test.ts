import { describe, expect, test } from 'bun:test'
import {
  INDICATOR_CATEGORIES,
  PERIOD_KINDS,
  indicatorAliases,
  indicatorCategory,
  indicatorId,
  indicatorKindLabel,
  indicatorLabel,
  indicatorParamFields,
  normalizeIndicatorId,
  parseIndicatorId,
  validIndicatorParams,
  withIndicatorParam,
  type IndicatorKind,
  type IndicatorParams,
} from './indicator-spec'

describe('parseIndicatorId — accepted spellings', () => {
  test('canonical ids parse to their params', () => {
    expect(parseIndicatorId('sma:20')).toEqual({ kind: 'sma', period: 20 })
    expect(parseIndicatorId('ema:200')).toEqual({ kind: 'ema', period: 200 })
    expect(parseIndicatorId('rsi:14')).toEqual({ kind: 'rsi', period: 14 })
    expect(parseIndicatorId('bb:20:2')).toEqual({ kind: 'bollinger', period: 20, stdDev: 2 })
    expect(parseIndicatorId('macd:12:26:9')).toEqual({
      kind: 'macd',
      fast: 12,
      slow: 26,
      signal: 9,
    })
    expect(parseIndicatorId('volume')).toEqual({ kind: 'volume' })
  })

  test('the historical preset ids parse as aliases (saved prefs must keep working)', () => {
    expect(parseIndicatorId('sma20')).toEqual({ kind: 'sma', period: 20 })
    expect(parseIndicatorId('sma50')).toEqual({ kind: 'sma', period: 50 })
    expect(parseIndicatorId('ema20')).toEqual({ kind: 'ema', period: 20 })
    expect(parseIndicatorId('bb20')).toEqual({ kind: 'bollinger', period: 20, stdDev: 2 })
    expect(parseIndicatorId('rsi14')).toEqual({ kind: 'rsi', period: 14 })
    expect(parseIndicatorId('macd')).toEqual({ kind: 'macd', fast: 12, slow: 26, signal: 9 })
  })

  test('agent spellings: case, spaces, dashes, kind names, bare kinds with defaults', () => {
    expect(parseIndicatorId('EMA 200')).toEqual({ kind: 'ema', period: 200 })
    expect(parseIndicatorId('ema-200')).toEqual({ kind: 'ema', period: 200 })
    expect(parseIndicatorId('bollinger:20')).toEqual({ kind: 'bollinger', period: 20, stdDev: 2 })
    expect(parseIndicatorId('Bollinger 20, 2.5')).toEqual({
      kind: 'bollinger',
      period: 20,
      stdDev: 2.5,
    })
    expect(parseIndicatorId('sma')).toEqual({ kind: 'sma', period: 20 })
    expect(parseIndicatorId('rsi')).toEqual({ kind: 'rsi', period: 14 })
    expect(parseIndicatorId('vol')).toEqual({ kind: 'volume' })
  })

  test('the six new kinds parse: canonical, aliases, spaced/joined, bare defaults', () => {
    expect(parseIndicatorId('vwap')).toEqual({ kind: 'vwap' })
    expect(parseIndicatorId('obv')).toEqual({ kind: 'obv' })
    expect(parseIndicatorId('supertrend:10:3')).toEqual({ kind: 'supertrend', period: 10, mult: 3 })
    // Envelopes: period + percent, aliases and defaults.
    expect(parseIndicatorId('envelope:20:2.5')).toEqual({ kind: 'envelope', period: 20, pct: 2.5 })
    expect(parseIndicatorId('env 50 3')).toEqual({ kind: 'envelope', period: 50, pct: 3 })
    expect(parseIndicatorId('envelopes')).toEqual({ kind: 'envelope', period: 20, pct: 2.5 })
    expect(indicatorId({ kind: 'envelope', period: 20, pct: 2.5 })).toBe('envelope:20:2.5')
    expect(parseIndicatorId('ST 10 3')).toEqual({ kind: 'supertrend', period: 10, mult: 3 })
    expect(parseIndicatorId('supertrend')).toEqual({ kind: 'supertrend', period: 10, mult: 3 })
    expect(parseIndicatorId('supertrend:14:2.5')).toEqual({
      kind: 'supertrend',
      period: 14,
      mult: 2.5,
    })
    expect(parseIndicatorId('stoch:14:3:3')).toEqual({ kind: 'stoch', k: 14, kSmooth: 3, d: 3 })
    expect(parseIndicatorId('Stochastic')).toEqual({ kind: 'stoch', k: 14, kSmooth: 3, d: 3 })
    expect(parseIndicatorId('stoch 5 3 3')).toEqual({ kind: 'stoch', k: 5, kSmooth: 3, d: 3 })
    expect(parseIndicatorId('atr14')).toEqual({ kind: 'atr', period: 14 })
    expect(parseIndicatorId('atr')).toEqual({ kind: 'atr', period: 14 })
    expect(parseIndicatorId('ADX')).toEqual({ kind: 'adx', period: 14 })
    expect(parseIndicatorId('dmi:14')).toEqual({ kind: 'adx', period: 14 })
  })

  test('garbage, wrong arity and out-of-range params are null — never a guess', () => {
    expect(parseIndicatorId('')).toBeNull()
    expect(parseIndicatorId('vwap:20')).toBeNull()
    expect(parseIndicatorId('ema:0')).toBeNull()
    expect(parseIndicatorId('ema:20.5')).toBeNull() // periods are whole bars
    expect(parseIndicatorId('ema:9999')).toBeNull()
    expect(parseIndicatorId('ema:20:30')).toBeNull() // one period only
    expect(parseIndicatorId('macd:12:26')).toBeNull() // macd is all three or none
    expect(parseIndicatorId('macd:26:12:9')).toBeNull() // fast must be < slow
    expect(parseIndicatorId('bb:20:0')).toBeNull() // zero-width bands draw nothing honest
    expect(parseIndicatorId('volume:20')).toBeNull()
    expect(parseIndicatorId('obv:20')).toBeNull() // parameterless kinds reject numerals
    expect(parseIndicatorId('supertrend:10:0')).toBeNull() // zero-width band
    expect(parseIndicatorId('supertrend:10:11')).toBeNull() // mult capped at 10
    expect(parseIndicatorId('stoch:14:3')).toBeNull() // stoch is all three or none
    expect(parseIndicatorId('atr:0')).toBeNull()
    expect(parseIndicatorId('adx:14:3')).toBeNull() // one period only
  })
})

describe('indicatorId — canonical formatting', () => {
  test('every accepted spelling round-trips to exactly ONE canonical id', () => {
    for (const [spelling, canonical] of [
      ['sma20', 'sma:20'],
      ['EMA 200', 'ema:200'],
      ['bollinger:20', 'bb:20:2'],
      ['bb:20:2.5', 'bb:20:2.5'],
      ['macd', 'macd:12:26:9'],
      ['rsi14', 'rsi:14'],
      ['volume', 'volume'],
      ['ST 10 3', 'supertrend:10:3'],
      ['stochastic', 'stoch:14:3:3'],
      ['dmi', 'adx:14'],
      ['VWAP', 'vwap'],
      ['obv', 'obv'],
      ['atr', 'atr:14'],
    ] as const) {
      expect(normalizeIndicatorId(spelling)).toBe(canonical)
      // The canonical id is a fixed point: normalizing it again changes nothing.
      expect(normalizeIndicatorId(canonical)).toBe(canonical)
    }
  })

  test('parse(format(params)) is the identity on valid params', () => {
    for (const p of [
      { kind: 'sma', period: 7 },
      { kind: 'ema', period: 200 },
      { kind: 'rsi', period: 21 },
      { kind: 'bollinger', period: 20, stdDev: 2.5 },
      { kind: 'macd', fast: 5, slow: 35, signal: 5 },
      { kind: 'supertrend', period: 10, mult: 2.5 },
      { kind: 'stoch', k: 14, kSmooth: 3, d: 3 },
      { kind: 'atr', period: 14 },
      { kind: 'adx', period: 14 },
      { kind: 'vwap' },
      { kind: 'obv' },
      { kind: 'volume' },
    ] as const) {
      expect(parseIndicatorId(indicatorId(p))).toEqual(p)
    }
  })

  test('normalizeIndicatorId is null exactly when parse is', () => {
    expect(normalizeIndicatorId('nope')).toBeNull()
    expect(normalizeIndicatorId('ema:banana')).toBeNull()
  })
})

describe('validIndicatorParams', () => {
  test('rejects out-of-range values a caller might construct directly', () => {
    expect(validIndicatorParams({ kind: 'sma', period: 0 })).toBeNull()
    expect(validIndicatorParams({ kind: 'bollinger', period: 20, stdDev: 11 })).toBeNull()
    expect(validIndicatorParams({ kind: 'macd', fast: 26, slow: 12, signal: 9 })).toBeNull()
    expect(validIndicatorParams({ kind: 'ema', period: 55 })).toEqual({ kind: 'ema', period: 55 })
    expect(validIndicatorParams({ kind: 'supertrend', period: 10, mult: 0 })).toBeNull()
    expect(validIndicatorParams({ kind: 'stoch', k: 14, kSmooth: 0, d: 3 })).toBeNull()
    expect(validIndicatorParams({ kind: 'adx', period: 501 })).toBeNull()
  })
})

describe('indicatorLabel', () => {
  test('names the parameters the way the old fixed menu did', () => {
    expect(indicatorLabel({ kind: 'sma', period: 20 })).toBe('SMA 20')
    expect(indicatorLabel({ kind: 'bollinger', period: 20, stdDev: 2 })).toBe('Bollinger (20, 2σ)')
    expect(indicatorLabel({ kind: 'macd', fast: 12, slow: 26, signal: 9 })).toBe('MACD (12, 26, 9)')
    expect(indicatorLabel({ kind: 'volume' })).toBe('Volume')
    expect(indicatorLabel({ kind: 'supertrend', period: 10, mult: 3 })).toBe('SuperTrend (10, 3)')
    expect(indicatorLabel({ kind: 'stoch', k: 14, kSmooth: 3, d: 3 })).toBe('Stoch (14, 3, 3)')
    expect(indicatorLabel({ kind: 'vwap' })).toBe('VWAP (daily)')
    expect(indicatorLabel({ kind: 'obv' })).toBe('OBV')
    expect(indicatorLabel({ kind: 'atr', period: 14 })).toBe('ATR 14')
    expect(indicatorLabel({ kind: 'adx', period: 14 })).toBe('ADX 14')
  })
})

describe('indicatorAliases', () => {
  test('returns the alias spellings for a kind, excluding its canonical token', () => {
    expect(indicatorAliases('hma')).toContain('hull')
    expect(indicatorAliases('keltner')).toContain('kc')
    expect(indicatorAliases('efi')).toEqual(expect.arrayContaining(['force', 'forceindex']))
    expect(indicatorAliases('hma')).not.toContain('hma') // canonical excluded
  })

  test('a kind with no extra spellings yields an empty list', () => {
    expect(indicatorAliases('sma')).toEqual([])
  })
})

describe('indicatorCategory', () => {
  test('places each family correctly', () => {
    expect(indicatorCategory('ema')).toBe('trend')
    expect(indicatorCategory('adx')).toBe('trend') // trend-STRENGTH lives with trend
    expect(indicatorCategory('ichimoku')).toBe('trend')
    expect(indicatorCategory('rsi')).toBe('momentum')
    expect(indicatorCategory('macd')).toBe('momentum')
    expect(indicatorCategory('bollinger')).toBe('volatility')
    expect(indicatorCategory('atr')).toBe('volatility')
    expect(indicatorCategory('obv')).toBe('volume')
    expect(indicatorCategory('volume')).toBe('volume')
  })

  test('every kind maps to a category the menu lists', () => {
    // The full kind universe: the period kinds plus the multi-param / parameterless ones.
    const kinds: IndicatorKind[] = [
      ...PERIOD_KINDS,
      'bollinger',
      'bbw',
      'bbpct',
      'keltner',
      'envelope',
      'ichimoku',
      'ao',
      'vwapband',
      'pivots',
      'ad',
      'coppock',
      'kst',
      'klinger',
      'efi',
      'dpo',
      'fisher',
      'hv',
      'eom',
      'macd',
      'supertrend',
      'stoch',
      'vwap',
      'obv',
      'volume',
    ]
    const valid = new Set(INDICATOR_CATEGORIES.map((c) => c.key))
    for (const kind of kinds) expect(valid.has(indicatorCategory(kind))).toBe(true)
  })
})

describe('indicatorKindLabel / indicatorParamFields / withIndicatorParam', () => {
  test('the kind label is the label with its parameters taken off', () => {
    expect(indicatorKindLabel('ema')).toBe('EMA')
    expect(indicatorKindLabel('bollinger')).toBe('Bollinger')
    expect(indicatorKindLabel('supertrend')).toBe('SuperTrend')
    // VWAP's label carries a `(daily)` suffix that is NOT a parameter — the name stays bare.
    expect(indicatorKindLabel('vwap')).toBe('VWAP')
    expect(indicatorLabel({ kind: 'vwap' })).toBe('VWAP (daily)')
  })

  test('the fields are the id, in order — a field per parameter, none for the parameterless', () => {
    const cases: Array<[IndicatorParams, number]> = [
      [{ kind: 'ema', period: 20 }, 1],
      [{ kind: 'bollinger', period: 20, stdDev: 2 }, 2],
      [{ kind: 'macd', fast: 12, slow: 26, signal: 9 }, 3],
      [{ kind: 'supertrend', period: 10, mult: 3 }, 2],
      [{ kind: 'stoch', k: 14, kSmooth: 3, d: 3 }, 3],
      [{ kind: 'vwap' }, 0],
      [{ kind: 'obv' }, 0],
      [{ kind: 'volume' }, 0],
    ]
    for (const [params, count] of cases) {
      expect(indicatorParamFields(params)).toHaveLength(count)
    }
  })

  test('every field round-trips through withIndicatorParam at its own index', () => {
    // The inline editor folds each field back by index; a mismatch here would silently write one
    // parameter into another (a MACD `signal` edit landing on `fast`).
    const params: IndicatorParams = { kind: 'macd', fast: 12, slow: 26, signal: 9 }
    const fields = indicatorParamFields(params)
    fields.forEach((field, index) => {
      const edited = withIndicatorParam(params, index, 99)
      expect(indicatorParamFields(edited)[index]).toEqual({ label: field.label, value: 99 })
      // Only that one field moved.
      fields.forEach((other, j) => {
        if (j !== index) expect(indicatorParamFields(edited)[j]).toEqual(other)
      })
    })
  })

  test('a parameterless kind ignores an edit rather than inventing a field', () => {
    expect(withIndicatorParam({ kind: 'vwap' }, 0, 20)).toEqual({ kind: 'vwap' })
    expect(withIndicatorParam({ kind: 'obv' }, 0, 20)).toEqual({ kind: 'obv' })
  })

  test('an edited spec re-ids through the same grammar the agent speaks', () => {
    const edited = withIndicatorParam({ kind: 'ema', period: 20 }, 0, 200)
    expect(indicatorId(edited)).toBe('ema:200')
    expect(normalizeIndicatorId('EMA 200')).toBe('ema:200')
  })
})

describe('the shared arms: every period kind and every parameterless kind', () => {
  const PARAMLESS: IndicatorKind[] = [
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
  ]

  test('a period kind validates its period, ids as kind:period, labels it and edits it', () => {
    for (const kind of PERIOD_KINDS) {
      const p: IndicatorParams = { kind, period: 21 }
      expect(validIndicatorParams(p)).toBe(p)
      expect(validIndicatorParams({ kind, period: 0 })).toBeNull()
      expect(indicatorId(p)).toBe(`${kind}:21`)
      expect(indicatorLabel(p)).toBe(`${indicatorKindLabel(kind)} 21`)
      expect(indicatorParamFields(p)).toEqual([{ label: 'Period', value: 21 }])
      expect(withIndicatorParam(p, 0, 34)).toEqual({ kind, period: 34 })
    }
  })

  test('a parameterless kind is always valid, ids as its kind and has no fields', () => {
    for (const kind of PARAMLESS) {
      const p = { kind } as IndicatorParams
      expect(validIndicatorParams(p)).toBe(p)
      expect(indicatorId(p)).toBe(kind)
      expect(indicatorParamFields(p)).toEqual([])
      expect(withIndicatorParam(p, 0, 5)).toBe(p)
    }
    for (const kind of ['obv', 'volume', 'ad', 'coppock', 'kst', 'klinger'] as const) {
      expect(indicatorLabel({ kind })).toBe(indicatorKindLabel(kind))
    }
  })
})
