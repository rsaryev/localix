import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import { renderVolumeProfile, valueAreaPosition, volumeProfile } from './volume-profile'

const bar = (time: number, high: number, low: number, close: number, volume: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume,
})

describe('volumeProfile', () => {
  it('puts the POC at the price band where the most volume traded', () => {
    // 14 bars: most bars cluster tightly at ~100 with high volume; a few spikes carry little.
    const candles: Candle[] = []
    for (let i = 0; i < 12; i++) candles.push(bar(i * 60, 100.5, 99.5, 100, 1000))
    candles.push(bar(12 * 60, 110, 109, 109.5, 5)) // a thin excursion up
    candles.push(bar(13 * 60, 91, 90, 90.5, 5)) // a thin excursion down
    const vp = volumeProfile(candles)!
    expect(vp.poc).toBeGreaterThan(99)
    expect(vp.poc).toBeLessThan(101)
    // Value area brackets the POC and holds most of the volume.
    expect(vp.val).toBeLessThanOrEqual(vp.poc)
    expect(vp.vah).toBeGreaterThanOrEqual(vp.poc)
    expect(vp.valueAreaPct).toBeGreaterThanOrEqual(0.7)
  })

  it('returns null with too few bars', () => {
    expect(volumeProfile([bar(0, 101, 99, 100, 10), bar(60, 101, 99, 100, 10)])).toBeNull()
  })

  it('returns null on a flat price range', () => {
    const flat = Array.from({ length: 12 }, (_, i) => bar(i * 60, 100, 100, 100, 10))
    expect(volumeProfile(flat)).toBeNull()
  })
})

describe('renderVolumeProfile', () => {
  it('renders POC and value area', () => {
    const candles = Array.from({ length: 12 }, (_, i) => bar(i * 60, 100.5, 99.5, 100, 1000))
    candles.push(bar(720, 110, 90, 100, 10))
    const text = renderVolumeProfile(volumeProfile(candles)).join('\n')
    expect(text).toContain('volume profile: POC')
    expect(text).toContain('value area')
  })

  it('renders nothing for a null profile', () => {
    expect(renderVolumeProfile(null)).toHaveLength(0)
  })

  it('states premium / discount / fair when a price is given', () => {
    const vp = { poc: 100, vah: 105, val: 95, valueAreaPct: 0.7 }
    expect(renderVolumeProfile(vp, 110).join('')).toContain('premium')
    expect(renderVolumeProfile(vp, 90).join('')).toContain('discount')
    expect(renderVolumeProfile(vp, 100).join('')).toContain('fair value')
  })
})

describe('valueAreaPosition', () => {
  const vp = { poc: 100, vah: 105, val: 95, valueAreaPct: 0.7 }
  it('classifies price above VAH as premium, below VAL as discount, inside as fair', () => {
    expect(valueAreaPosition(vp, 106)).toBe('premium')
    expect(valueAreaPosition(vp, 94)).toBe('discount')
    expect(valueAreaPosition(vp, 100)).toBe('fair')
  })
})
