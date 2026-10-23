import { describe, expect, test } from 'bun:test'
import { layoutTimeframes, timeframeLabel, timeframeTitle } from './timeframeBar'

const PREFERRED = ['1h', '15m', '1m', '4h', '1d']

describe('timeframeLabel', () => {
  test('shortens the long-period keys, verbatim otherwise', () => {
    expect(timeframeLabel('1d')).toBe('D')
    expect(timeframeLabel('1w')).toBe('W')
    expect(timeframeLabel('1M')).toBe('M')
    expect(timeframeLabel('5m')).toBe('5m')
    expect(timeframeLabel('1h')).toBe('1h')
  })
})

describe('layoutTimeframes', () => {
  test('inline is the preferred set the venue supports, in preferred order', () => {
    const { inline } = layoutTimeframes(['1m', '5m', '15m', '1h', '4h', '1d'], PREFERRED)
    expect(inline).toEqual(['1h', '15m', '1m', '4h', '1d'])
  })

  test('never surfaces a preferred timeframe the venue lacks', () => {
    const { inline } = layoutTimeframes(['5m', '1h', '1d'], PREFERRED)
    expect(inline).toEqual(['1h', '1d'])
    expect(inline).not.toContain('1m')
  })

  test('every other supported timeframe folds into overflow, in venue order', () => {
    const { overflow } = layoutTimeframes(
      ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w'],
      PREFERRED,
    )
    expect(overflow).toEqual(['5m', '30m', '1w'])
  })

  test('each supported timeframe lands in exactly one list', () => {
    const tfs = ['1m', '3m', '5m', '15m', '1h', '2h', '4h', '1d', '1w']
    const { inline, overflow } = layoutTimeframes(tfs, PREFERRED)
    expect([...inline, ...overflow].sort()).toEqual([...tfs].sort())
    expect(inline.some((t) => overflow.includes(t))).toBe(false)
  })

  test('empty venue list yields empty layout', () => {
    expect(layoutTimeframes([], PREFERRED)).toEqual({ inline: [], overflow: [] })
  })
})

describe('timeframeTitle', () => {
  test('m is a minute and M is a month — the only pair that differs by case alone', () => {
    expect(timeframeTitle('1m')).toBe('1 minute')
    expect(timeframeTitle('1M')).toBe('1 month')
  })

  test('plurals read naturally', () => {
    expect(timeframeTitle('15m')).toBe('15 minutes')
    expect(timeframeTitle('4h')).toBe('4 hours')
    expect(timeframeTitle('1h')).toBe('1 hour')
    expect(timeframeTitle('3d')).toBe('3 days')
    expect(timeframeTitle('1w')).toBe('1 week')
  })

  test('an unrecognised key is shown verbatim rather than given a guessed unit', () => {
    expect(timeframeTitle('1y')).toBe('1y')
    expect(timeframeTitle('weekly')).toBe('weekly')
  })
})
