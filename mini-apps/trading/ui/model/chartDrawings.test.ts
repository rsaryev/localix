import { describe, expect, test } from 'bun:test'
import type { ChartDrawing } from '../../backend/chart-drawing'
import {
  MAX_DRAWINGS,
  MARKER_BUY_COLOR,
  MARKER_SELL_COLOR,
  applyDrawCommand,
  dashPattern,
  drawingTitle,
  isDetectDrawingId,
  loadDrawings,
  migrateDrawings,
  nextDrawingId,
  seriesMarkersOf,
} from './chartDrawings'

const hline = (id: string, price = 100): ChartDrawing => ({ kind: 'hline', id, price })

const marker = (id: string, time: number, side: 'buy' | 'sell' = 'buy'): ChartDrawing => ({
  kind: 'marker',
  id,
  time,
  side,
})

describe('nextDrawingId', () => {
  test('counts past the highest auto id, ignoring agent-chosen names', () => {
    expect(nextDrawingId([])).toBe('d1')
    expect(nextDrawingId([hline('d1'), hline('d7')])).toBe('d8')
    expect(nextDrawingId([hline('resistance'), hline('d2')])).toBe('d3')
    // `d10x` is not an auto id; it must not poison the counter.
    expect(nextDrawingId([{ ...hline('d10x') }])).toBe('d1')
  })
})

describe('isDetectDrawingId', () => {
  test('separates the detect auto-draw overlays from hand-placed drawings', () => {
    for (const id of [
      'pat-s1',
      'fib-golden',
      'fvg-2',
      'struct-brk',
      'vol-poc',
      'vol-va',
      'vwap-mid',
    ])
      expect(isDetectDrawingId(id)).toBe(true)
    for (const id of ['d1', 'd42', 'resistance', 'my-line'])
      expect(isDetectDrawingId(id)).toBe(false)
  })
})

describe('applyDrawCommand — the reducer', () => {
  test('add without an id assigns the next auto id and appends', () => {
    const next = applyDrawCommand([hline('d1')], 'add', { kind: 'hline', price: 200 })
    expect(next).toEqual([hline('d1'), { kind: 'hline', id: 'd2', price: 200 }])
  })

  test('add with a known id REPLACES in place (idempotent under duplicate delivery)', () => {
    const once = applyDrawCommand([hline('d1'), hline('d2')], 'add', {
      kind: 'hline',
      id: 'd1',
      price: 999,
    })
    expect(once).toEqual([hline('d1', 999), hline('d2')])
    const twice = applyDrawCommand(once, 'add', { kind: 'hline', id: 'd1', price: 999 })
    expect(twice).toEqual(once)
  })

  test('remove deletes by id; an unknown or absent id is a quiet no-op', () => {
    expect(applyDrawCommand([hline('d1'), hline('d2')], 'remove', undefined, 'd1')).toEqual([
      hline('d2'),
    ])
    expect(applyDrawCommand([hline('d1')], 'remove', undefined, 'nope')).toEqual([hline('d1')])
    expect(applyDrawCommand([hline('d1')], 'remove')).toEqual([hline('d1')])
  })

  test('clear empties; add without a drawing is a no-op copy', () => {
    expect(applyDrawCommand([hline('d1')], 'clear')).toEqual([])
    const current = [hline('d1')]
    const copy = applyDrawCommand(current, 'add')
    expect(copy).toEqual(current)
    expect(copy).not.toBe(current)
  })

  test('the list is capped — an add past MAX_DRAWINGS drops the oldest', () => {
    let list: ChartDrawing[] = []
    for (let i = 0; i < MAX_DRAWINGS + 2; i++) {
      list = applyDrawCommand(list, 'add', { kind: 'hline', price: i })
    }
    expect(list).toHaveLength(MAX_DRAWINGS)
    expect(list[0]!.id).toBe('d3')
    expect(list.at(-1)!.id).toBe(`d${MAX_DRAWINGS + 2}`)
  })
})

describe('migrateDrawings — the stored-list guard', () => {
  test('non-arrays and malformed/id-less entries are dropped, never the whole list', () => {
    expect(migrateDrawings(undefined)).toEqual([])
    expect(migrateDrawings('[]')).toEqual([])
    expect(
      migrateDrawings([
        hline('d1'),
        { kind: 'hline', price: 5 }, // no id — the reducer always assigns one before saving
        { kind: 'circle', id: 'd9' },
        { kind: 'vline', id: 'd2', time: 1_700_000_000 },
      ]),
    ).toEqual([hline('d1'), { kind: 'vline', id: 'd2', time: 1_700_000_000 }])
  })

  test('duplicate ids keep the first entry', () => {
    expect(migrateDrawings([hline('d1', 1), hline('d1', 2)])).toEqual([hline('d1', 1)])
  })

  test('loadDrawings degrades to an empty list where localStorage is unavailable', () => {
    expect(loadDrawings('trading:chart:c1:BTC')).toEqual([])
  })
})

describe('dashPattern', () => {
  test('maps each style to its canvas dash (solid/unknown → none)', () => {
    expect(dashPattern('dashed')).toEqual([6, 4])
    expect(dashPattern('dotted')).toEqual([2, 3])
    expect(dashPattern('solid')).toEqual([])
    expect(dashPattern(undefined)).toEqual([])
  })
})

describe('seriesMarkersOf — marker drawings → native series markers', () => {
  test('maps side to position/shape/tint and rides id + label through', () => {
    const out = seriesMarkersOf([
      { kind: 'marker', id: 'm1', time: 1_700_000_000, side: 'buy', label: 'entry' },
      { kind: 'marker', id: 'm2', time: 1_700_003_600, side: 'sell' },
    ])
    expect(out).toEqual([
      {
        time: 1_700_000_000,
        position: 'belowBar',
        shape: 'arrowUp',
        color: MARKER_BUY_COLOR,
        id: 'm1',
        text: 'entry',
      },
      {
        time: 1_700_003_600,
        position: 'aboveBar',
        shape: 'arrowDown',
        color: MARKER_SELL_COLOR,
        id: 'm2',
      },
    ] as ReturnType<typeof seriesMarkersOf>)
  })

  test('sorts ascending by time (the library requires the order) and skips non-markers', () => {
    const out = seriesMarkersOf([hline('d1'), marker('m2', 2_000), marker('m1', 1_000, 'sell')])
    expect(out.map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  test('an explicit drawing color wins over the side tint', () => {
    const out = seriesMarkersOf([
      { kind: 'marker', id: 'm1', time: 1, side: 'buy', color: '#ffffff' },
    ])
    expect(out[0]!.color).toBe('#ffffff')
  })

  test('an empty or marker-free list maps to no markers', () => {
    expect(seriesMarkersOf([])).toEqual([])
    expect(seriesMarkersOf([hline('d1')])).toEqual([])
  })
})

describe('hline near-duplicate merge', () => {
  test('a new hline within tolerance replaces the existing line instead of stacking', () => {
    const one = applyDrawCommand([], 'add', { kind: 'hline', id: 'manual', price: 255 })
    const merged = applyDrawCommand(one, 'add', {
      kind: 'hline',
      id: 'pat-s1',
      price: 255.3, // 0.12% away — same zone
      label: 'Support ×3',
    })
    expect(merged).toHaveLength(1)
    expect(merged[0]!.id).toBe('pat-s1')
  })

  test('a distinct level does not merge, and non-hlines never do', () => {
    const one = applyDrawCommand([], 'add', { kind: 'hline', id: 'a', price: 255 })
    expect(applyDrawCommand(one, 'add', { kind: 'hline', id: 'b', price: 260 })).toHaveLength(2)
    expect(applyDrawCommand(one, 'add', { kind: 'vline', id: 'v', time: 1 } as never)).toHaveLength(
      2,
    )
  })
})

describe('drawingTitle — the badge label', () => {
  test('strips trailing prices but keeps touch counts and words', () => {
    expect(drawingTitle('Support 255')).toBe('Support')
    expect(drawingTitle('EMA 200 = 298.5')).toBe('EMA 200')
    expect(drawingTitle('MA20/50 cluster ~263')).toBe('MA20/50 cluster')
    expect(drawingTitle('Resistance ×3')).toBe('Resistance ×3')
    expect(drawingTitle('Major H 340.64')).toBe('Major H')
  })

  test('never returns empty for a non-empty label, truncates long ones', () => {
    expect(drawingTitle('243.50')).toBe('243.50') // all-price label: keep it, price IS the name
    expect(drawingTitle(undefined)).toBe('')
    expect(drawingTitle('a very long descriptive level label')).toHaveLength(18)
  })
})
