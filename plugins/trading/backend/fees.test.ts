import { describe, expect, test } from 'bun:test'
import { estimateFee, feesLine, formatFeeRate } from './fees'

describe('estimateFee', () => {
  test('notional × rate', () => {
    expect(estimateFee(1000, 0.00045)).toBeCloseTo(0.45, 10)
  })
  test('an unknown rate is not a zero fee', () => {
    expect(estimateFee(1000, undefined)).toBeNull()
  })
  test('an unknown notional is not a zero fee', () => {
    expect(estimateFee(null, 0.00045)).toBeNull()
  })
})

describe('formatFeeRate', () => {
  test('a fraction becomes a trimmed percentage', () => {
    expect(formatFeeRate(0.00045)).toBe('0.045%')
    expect(formatFeeRate(0.001)).toBe('0.1%')
    expect(formatFeeRate(0)).toBe('0%')
  })

  test('an unreported rate is null, not 0%', () => {
    expect(formatFeeRate(undefined)).toBeNull()
    expect(formatFeeRate(Number.NaN)).toBeNull()
  })
})

describe('feesLine — the agent must not read silence as "free"', () => {
  test('both sides reported', () => {
    const line = feesLine({ maker: 0.0001, taker: 0.00045 })
    expect(line).toBe('fees: maker 0.01% · taker 0.045% (a market order pays taker)')
  })

  test('one side missing is NAMED as missing, never rendered as 0%', () => {
    expect(feesLine({ taker: 0.00045 })).toContain('maker not reported')
    expect(feesLine({ taker: 0.00045 })).not.toContain('maker 0%')
  })

  test('a venue that reported neither says so out loud', () => {
    // An omitted line would read as "no fees on this market" — a claim about money.
    expect(feesLine(undefined)).toContain('do NOT assume this market is free to trade')
    expect(feesLine({})).toContain('did not report them')
  })

  test('a genuinely reported ZERO rate is a rate, not an absence', () => {
    expect(feesLine({ maker: 0, taker: 0.0003 })).toContain('maker 0%')
  })
})
