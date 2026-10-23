import { describe, expect, it } from 'bun:test'
import { fundingRead, renderFundingRead } from './funding-read'

const funding = (rate: number, interval?: string) => ({ symbol: 'BTC/USDC:USDC', rate, interval })

describe('fundingRead', () => {
  it('abstains without a reported interval (never assumes 8h) or a finite rate', () => {
    expect(fundingRead(funding(0.0001))).toBeNull()
    expect(fundingRead(funding(Number.NaN, '8h'))).toBeNull()
    expect(fundingRead(null)).toBeNull()
  })

  it('normalizes a 1h venue onto the 8h scale before classifying', () => {
    // 0.00625bp/h × 8 = 0.05%/8h — exactly the extreme-crowding boundary (strictly above trips).
    const boundary = fundingRead(funding(0.0000625, '1h'))!
    expect(boundary.ratePct8h).toBeCloseTo(0.05, 10)
    expect(boundary.state).toBe('elevated_long_bias') // boundary itself is NOT extreme
    const extreme = fundingRead(funding(0.00007, '1h'))!
    expect(extreme.state).toBe('extreme_long_crowding')
  })

  it('classifies the mined table bands on an 8h venue, both signs', () => {
    expect(fundingRead(funding(0.0006, '8h'))!.state).toBe('extreme_long_crowding')
    expect(fundingRead(funding(0.0003, '8h'))!.state).toBe('elevated_long_bias')
    expect(fundingRead(funding(0.0001, '8h'))!.state).toBe('mild_long_bias')
    expect(fundingRead(funding(0, '8h'))!.state).toBe('balanced')
    expect(fundingRead(funding(-0.0001, '8h'))!.state).toBe('mild_short_bias')
    expect(fundingRead(funding(-0.0003, '8h'))!.state).toBe('short_squeeze_territory')
  })

  it('annualizes at ×3×365 and renders who pays whom', () => {
    const f = fundingRead(funding(0.0001, '8h'))! // 0.01%/8h → ~10.95% annualized
    expect(f.annualizedPct).toBeCloseTo(10.95, 2)
    const line = renderFundingRead(f).join('\n')
    expect(line).toContain('+0.0100%/8h')
    expect(line).toContain('longs pay shorts')
    const short = renderFundingRead(fundingRead(funding(-0.0003, '8h'))!).join('\n')
    expect(short).toContain('shorts pay longs')
    expect(short).toContain('SHORT-SQUEEZE')
  })
})
