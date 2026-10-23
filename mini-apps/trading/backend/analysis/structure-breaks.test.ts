import { describe, expect, it } from 'bun:test'
import type { Candle } from '../contracts'
import {
  detectStructureBreak,
  renderStructureBreak,
  structureBreakDrawPayloads,
} from './structure-breaks'

const bar = (time: number, high: number, low: number, close: number): Candle => ({
  time,
  open: close,
  high,
  low,
  close,
  volume: 10,
})

describe('detectStructureBreak', () => {
  it('reads a bullish BOS: up-structure, close breaks the last swing high (continuation)', () => {
    // Swing highs 12 then 14 (HH), swing lows 6 then 8 (HL) → bullish; last bar closes 16 > 14.
    const brk = detectStructureBreak(
      [
        bar(0, 10, 8, 9),
        bar(60, 12, 9, 11), // swing high 12
        bar(120, 9, 6, 7), // swing low 6
        bar(180, 14, 10, 12), // swing high 14
        bar(240, 11, 8, 9), // swing low 8
        bar(300, 16, 12, 16), // close 16 breaks the swing high 14
      ],
      1,
    )!
    expect(brk.type).toBe('BOS')
    expect(brk.direction).toBe('bullish')
    expect(brk.level).toBeCloseTo(14, 5)
  })

  it('reads a bearish ChoCH: up-structure, close breaks the last swing low (character change)', () => {
    const brk = detectStructureBreak(
      [
        bar(0, 10, 8, 9),
        bar(60, 12, 9, 11), // swing high 12
        bar(120, 9, 6, 7), // swing low 6
        bar(180, 14, 10, 12), // swing high 14
        bar(240, 11, 7, 9), // swing low 7 (HL → up-structure)
        bar(300, 10.5, 9, 10), // consolidates below the high, keeps the swing low confirmed
        bar(360, 10, 5, 6), // close 6 breaks the swing low 7 — against the up-structure
      ],
      1,
    )!
    expect(brk.type).toBe('ChoCH')
    expect(brk.direction).toBe('bearish')
    expect(brk.level).toBeCloseTo(7, 5)
  })

  it('returns null when structure is intact (rangebound, no swing broken)', () => {
    const brk = detectStructureBreak(
      [
        bar(0, 101, 99, 100),
        bar(60, 102, 100, 101), // swing high 102
        bar(120, 100, 98, 99), // swing low 98
        bar(180, 102, 100, 101), // swing high 102
        bar(240, 100, 98, 99), // swing low 98
        bar(300, 101, 99, 100),
      ],
      1,
    )
    expect(brk).toBeNull()
  })

  it('returns null below the minimum window', () => {
    expect(detectStructureBreak([bar(0, 10, 8, 9), bar(60, 12, 9, 11)], 1)).toBeNull()
  })
})

describe('renderStructureBreak', () => {
  it('renders a BOS as continuation', () => {
    const text = renderStructureBreak({
      type: 'BOS',
      direction: 'bullish',
      level: 14,
      brokenAt: 300,
      swingTime: 180,
    }).join('\n')
    expect(text).toContain('bullish BOS')
    expect(text).toContain('continuation')
  })

  it('renders a ChoCH as a character change', () => {
    const text = renderStructureBreak({
      type: 'ChoCH',
      direction: 'bearish',
      level: 7,
      brokenAt: 360,
      swingTime: 240,
    }).join('\n')
    expect(text).toContain('bearish ChoCH')
    expect(text).toContain('character change')
  })

  it('renders nothing when structure is intact', () => {
    expect(renderStructureBreak(null)).toHaveLength(0)
  })
})

describe('structureBreakDrawPayloads', () => {
  it('draws a stable-id hline at the broken swing level', () => {
    const payloads = structureBreakDrawPayloads('conn', 'BTC/USDT', {
      type: 'BOS',
      direction: 'bullish',
      level: 14,
      brokenAt: 300,
      swingTime: 180,
    })
    expect(payloads).toHaveLength(1)
    const drawing = payloads[0]!.drawing!
    expect(drawing.id).toBe('struct-brk')
    if (drawing.kind !== 'hline') throw new Error(`expected an hline, got ${drawing.kind}`)
    expect(drawing.price).toBeCloseTo(14, 5)
  })

  it('draws nothing when structure is intact', () => {
    expect(structureBreakDrawPayloads('c', 'S', null)).toHaveLength(0)
  })
})
