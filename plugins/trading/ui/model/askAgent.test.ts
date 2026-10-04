import { describe, expect, test } from 'bun:test'

import {
  buildBookLevelPrefill,
  buildCarryStatPrefill,
  buildTapePrintPrefill,
  buildTechnicalAnalysisPrefill,
  type AnalysisRequest,
} from './askAgent'

const ref = { connectionId: 'public:hyperliquid', symbol: 'BTC/USDC:USDC' }

describe('buildBookLevelPrefill', () => {
  test('links the orderbook leaf and names the wall with its resting size', () => {
    const p = buildBookLevelPrefill(ref, {
      side: 'bid',
      price: '63,900',
      size: '12.4',
      sizeUnit: 'BTC',
    })
    const [token, blank, subject] = p.text.split('\n')
    expect(token).toBe(
      '@resource:localix://resource/trade/public%3Ahyperliquid/markets/BTC%2FUSDC%3AUSDC/orderbook',
    )
    expect(blank).toBe('')
    expect(subject).toBe('BTC/USDC:USDC bid wall at 63,900 (12.4 BTC resting) — ')
  })

  test('drops the resting clause when the caller has no size', () => {
    const p = buildBookLevelPrefill(ref, { side: 'ask', price: '64,100' })
    expect(p.text).toContain('BTC/USDC:USDC ask wall at 64,100 — ')
    expect(p.text).not.toContain('resting')
  })
})

describe('buildTapePrintPrefill', () => {
  test('links the venue tape (never fills) and reads like the row', () => {
    const p = buildTapePrintPrefill(ref, {
      side: 'sell',
      price: '63,901',
      size: '0.52',
      sizeUnit: 'BTC',
      time: '12:03:11',
    })
    expect(p.text).toContain('/trades\n\n')
    expect(p.text).toContain('BTC/USDC:USDC sell print 0.52 BTC @ 63,901 (12:03:11) — ')
  })

  test('unstamped print carries no time clause', () => {
    const p = buildTapePrintPrefill(ref, { side: 'buy', price: '63,900', size: '1' })
    expect(p.text).toContain('buy print 1 @ 63,900 — ')
    expect(p.text).not.toContain('()')
  })

  test('carries the aggressor-flow context when given', () => {
    const p = buildTapePrintPrefill(ref, {
      side: 'buy',
      price: '63,900',
      size: '1',
      flow: { buyPct: 63, prints: 40 },
    })
    expect(p.text).toContain('recent flow 63% buy / 37% sell over the last 40 prints')
  })
})

describe('buildCarryStatPrefill', () => {
  test('funding and open interest both link the funding leaf', () => {
    const funding = buildCarryStatPrefill(ref, { label: 'funding', value: '0.0100% / 8h' })
    expect(funding.text).toContain('/funding\n\n')
    expect(funding.text).toContain('BTC/USDC:USDC funding 0.0100% / 8h — ')

    const oi = buildCarryStatPrefill(ref, { label: 'open interest', value: '18.4K BTC' })
    expect(oi.text).toContain('/funding\n\n')
    expect(oi.text).toContain('BTC/USDC:USDC open interest 18.4K BTC — ')
  })
})

describe('buildTechnicalAnalysisPrefill', () => {
  const base: AnalysisRequest = {
    timeframe: '1h',
    style: 'intraday',
    strategy: 'trend',
    bias: 'auto',
    risk: 'balanced',
    activeIndicators: ['ema:20', 'rsi:14'],
  }

  test('links the candles leaf and names the market + timeframe', () => {
    const p = buildTechnicalAnalysisPrefill(ref, base)
    expect(p.text).toContain('/candles\n\n')
    expect(p.text).toContain('BTC/USDC:USDC on the 1h timeframe')
  })

  test('drives the agent through detect → regime → composite signal', () => {
    const p = buildTechnicalAnalysisPrefill(ref, base)
    // detect is step 1 and is auto-drawn.
    expect(p.text).toContain('manage_chart action="detect" with auto_draw FIRST')
    expect(p.text).toContain('REGIME')
    // The narrative must reconcile with the composite vote, not ignore it.
    expect(p.text).toContain('composite')
    // The plan anchors to confluence zones (the strongest levels).
    expect(p.text).toContain('CONFLUENCE')
  })

  test('carries the hard risk numbers for the chosen profile', () => {
    const p = buildTechnicalAnalysisPrefill(ref, { ...base, risk: 'conservative' })
    expect(p.text).toContain('0.5%')
    expect(p.text).toContain('1:3')
  })

  test('enforces anti-fabrication discipline and forbids order placement', () => {
    const p = buildTechnicalAnalysisPrefill(ref, base)
    expect(p.text).toContain('cite the specific number behind every claim')
    expect(p.text).toContain('state the bear case')
    expect(p.text).toContain('do NOT place, modify, or cancel any orders')
  })

  test('bias-aware adds a personalize step referencing trade_history; off omits it', () => {
    const off = buildTechnicalAnalysisPrefill(ref, base)
    expect(off.text).not.toContain('trade_history')
    const on = buildTechnicalAnalysisPrefill(ref, { ...base, biasAware: true })
    expect(on.text).toContain('trade_history')
    expect(on.text).toContain('disposition effect')
  })

  test('an explicit bias is checked against the data, not assumed', () => {
    const long = buildTechnicalAnalysisPrefill(ref, { ...base, bias: 'long' })
    expect(long.text).toContain('LONG bias against the data')
    const auto = buildTechnicalAnalysisPrefill(ref, base)
    expect(auto.text).toContain('no directional bias')
  })
})
