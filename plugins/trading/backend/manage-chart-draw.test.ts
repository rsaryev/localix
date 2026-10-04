import { describe, expect, test } from 'bun:test'
import { parseChartCommandPayload } from './chart-command'
import { describeChartCommand } from './manage-chart'
import { buildChartDrawings, drawProblem, foldUnixSeconds } from './manage-chart-draw'
import {
  buildChartCommandPayload,
  manageChartInputSchema,
  manageChartProblem,
  type ManageChartInput,
} from './manage-chart-schema'

const input = (over: Partial<ManageChartInput>): ManageChartInput =>
  manageChartInputSchema.parse({ action: 'draw', symbol: 'BTC/USDC:USDC', ...over })

describe('drawProblem — the action=draw fix-its', () => {
  test('add without a drawing_kind names the kinds and the other modes', () => {
    expect(manageChartProblem(input({}))).toContain('drawing_kind')
    expect(manageChartProblem(input({}))).toContain('hline, trendline, vline')
  })

  test('hline needs a price; vline a time', () => {
    expect(drawProblem({ drawing_kind: 'hline' })).toContain('"price"')
    expect(drawProblem({ drawing_kind: 'hline', price: 65_000 })).toBeNull()
    expect(drawProblem({ drawing_kind: 'vline' })).toContain('"time"')
    expect(drawProblem({ drawing_kind: 'vline', time: 1_700_000_000 })).toBeNull()
  })

  test('trendline needs BOTH points and lists exactly what is missing', () => {
    expect(drawProblem({ drawing_kind: 'trendline', time: 1, price: 2 })).toContain(
      'missing: time2, price2',
    )
    expect(
      drawProblem({ drawing_kind: 'trendline', time: 1, price: 2, time2: 3, price2: 4 }),
    ).toBeNull()
  })

  test('a zero-width trendline is redirected to vline', () => {
    expect(
      drawProblem({ drawing_kind: 'trendline', time: 5, price: 1, time2: 5, price2: 2 }),
    ).toContain('vline')
  })

  test('marker needs a time and a side', () => {
    expect(drawProblem({ drawing_kind: 'marker' })).toContain('"time"')
    expect(drawProblem({ drawing_kind: 'marker', time: 1_700_000_000 })).toContain('"side"')
    expect(drawProblem({ drawing_kind: 'marker', time: 1_700_000_000, side: 'buy' })).toBeNull()
    // The recorded fill price is optional.
    expect(
      drawProblem({ drawing_kind: 'marker', time: 1_700_000_000, side: 'sell', price: 64_000 }),
    ).toBeNull()
  })

  test('zone needs two distinct prices', () => {
    expect(drawProblem({ drawing_kind: 'zone', price: 100 })).toContain('price2')
    expect(drawProblem({ drawing_kind: 'zone', price: 100, price2: 100 })).toContain('DISTINCT')
    expect(drawProblem({ drawing_kind: 'zone', price: 100, price2: 105 })).toBeNull()
  })

  test('remove needs a drawing_id; clear needs nothing', () => {
    expect(drawProblem({ draw_mode: 'remove' })).toContain('drawing_id')
    expect(drawProblem({ draw_mode: 'remove', drawing_id: 'd1' })).toBeNull()
    expect(drawProblem({ draw_mode: 'clear' })).toBeNull()
  })

  test("a non-hex color is fix-it'd (lightweight-charts throws on fancy syntaxes)", () => {
    expect(drawProblem({ drawing_kind: 'hline', price: 1, color: 'oklch(0.7 0.1 90)' })).toContain(
      'hex',
    )
    expect(drawProblem({ drawing_kind: 'hline', price: 1, color: '#f0a13a' })).toBeNull()
    expect(drawProblem({ drawing_kind: 'hline', price: 1, color: '#f0a13a80' })).toBeNull()
  })
})

describe('buildChartCommandPayload — action=draw → wire payload', () => {
  test('an hline add carries the validated drawing, and round-trips the sink guard', () => {
    const payload = buildChartCommandPayload(
      input({
        drawing_kind: 'hline',
        price: 65_000,
        drawing_id: 'r1',
        color: '#ff9900',
        line_style: 'dashed',
        label: 'resistance',
      }),
      'public:hyperliquid',
    )
    expect(payload).toEqual({
      action: 'draw',
      connectionId: 'public:hyperliquid',
      symbol: 'BTC/USDC:USDC',
      drawMode: 'add',
      drawing: {
        kind: 'hline',
        price: 65_000,
        id: 'r1',
        color: '#ff9900',
        lineStyle: 'dashed',
        label: 'resistance',
      },
    })
    expect(parseChartCommandPayload(payload)).toEqual(payload)
  })

  test('a marker add folds its time, carries side/price/label, and round-trips the sink guard', () => {
    const payload = buildChartCommandPayload(
      input({
        drawing_kind: 'marker',
        time: 1_700_000_000_000, // milliseconds — folded to seconds
        side: 'buy',
        price: 64_000,
        label: 'entry',
        drawing_id: 'm1',
      }),
      'c1',
    )
    expect(payload.drawing).toEqual({
      kind: 'marker',
      time: 1_700_000_000,
      side: 'buy',
      price: 64_000,
      id: 'm1',
      label: 'entry',
    })
    expect(parseChartCommandPayload(payload)).toEqual(payload)
  })

  test('trendline/vline times are folded from milliseconds INTO the drawing (no stray time field)', () => {
    const payload = buildChartCommandPayload(
      input({
        drawing_kind: 'trendline',
        time: 1_700_000_000_000,
        price: 60_000,
        time2: 1_700_360_000,
        price2: 70_000,
      }),
      'c1',
    )
    expect(payload.drawing).toEqual({
      kind: 'trendline',
      time1: 1_700_000_000,
      price1: 60_000,
      time2: 1_700_360_000,
      price2: 70_000,
    })
    expect(payload.time).toBeUndefined()
    expect(foldUnixSeconds(1_700_000_000_123)).toBe(1_700_000_000)
    expect(foldUnixSeconds(1_700_000_000)).toBe(1_700_000_000)
  })

  test('remove carries the id, clear carries only the mode — both round-trip the guard', () => {
    const remove = buildChartCommandPayload(input({ draw_mode: 'remove', drawing_id: 'd2' }), 'c1')
    expect(remove.drawMode).toBe('remove')
    expect(remove.drawingId).toBe('d2')
    expect(remove.drawing).toBeUndefined()
    expect(parseChartCommandPayload(remove)).toEqual(remove)

    const clear = buildChartCommandPayload(input({ draw_mode: 'clear' }), 'c1')
    expect(clear).toEqual({
      action: 'draw',
      connectionId: 'c1',
      symbol: 'BTC/USDC:USDC',
      drawMode: 'clear',
    })
    expect(parseChartCommandPayload(clear)).toEqual(clear)
  })

  test('the sink guard drops a payload whose drawing is malformed', () => {
    expect(
      parseChartCommandPayload({
        action: 'draw',
        connectionId: 'c1',
        symbol: 'BTC/USDC:USDC',
        drawMode: 'add',
        drawing: { kind: 'hline' },
      }),
    ).toBeNull()
    expect(
      parseChartCommandPayload({
        action: 'draw',
        connectionId: 'c1',
        symbol: 'BTC/USDC:USDC',
        drawMode: 'redraw',
      }),
    ).toBeNull()
  })
})

describe('describeChartCommand — draw narration', () => {
  test('an add without an id points the agent at the auto-id and the snapshot', () => {
    const text = describeChartCommand(
      buildChartCommandPayload(input({ drawing_kind: 'hline', price: 65_000 }), 'c1'),
      'hyperliquid',
    )
    expect(text).toContain('drawing added → horizontal line @ 65000')
    expect(text).toContain('auto-assigned')
  })

  test('remove and clear read as acts, with no auto-id chatter', () => {
    const remove = describeChartCommand(
      buildChartCommandPayload(input({ draw_mode: 'remove', drawing_id: 'd2' }), 'c1'),
      'hyperliquid',
    )
    expect(remove).toContain('drawing removed → d2')
    const clear = describeChartCommand(
      buildChartCommandPayload(input({ draw_mode: 'clear' }), 'c1'),
      'hyperliquid',
    )
    expect(clear).toContain('drawings → cleared')
    expect(clear).not.toContain('auto-assigned')
  })
})

describe('batched draw — the drawings array', () => {
  test('accepts a well-formed batch of mixed kinds', () => {
    expect(
      manageChartProblem(
        input({
          drawings: [
            { drawing_kind: 'hline', price: 65_000, label: 'R1' },
            { drawing_kind: 'zone', price: 64_000, price2: 63_500 },
            { drawing_kind: 'marker', time: 1_700_000_000, side: 'buy' },
          ],
        }),
      ),
    ).toBeNull()
  })

  test('names the offending item by index', () => {
    const problem = manageChartProblem(
      input({
        drawings: [
          { drawing_kind: 'hline', price: 65_000 },
          { drawing_kind: 'hline' }, // missing price
        ],
      }),
    )
    expect(problem).toContain('drawings[1]')
    expect(problem).toContain('"price"')
  })

  test('an empty batch is rejected with a fix-it', () => {
    expect(manageChartProblem(input({ drawings: [] }))).toContain('empty')
  })

  test('buildChartDrawings folds every item to a wire drawing (ids preserved)', () => {
    const wire = buildChartDrawings(
      input({
        drawings: [
          { drawing_kind: 'hline', price: 65_000, drawing_id: 'lvl-1' },
          { drawing_kind: 'zone', price: 64_000, price2: 63_500 },
        ],
      }),
    )
    expect(wire).toHaveLength(2)
    expect(wire[0]).toMatchObject({ kind: 'hline', price: 65_000, id: 'lvl-1' })
    expect(wire[1]).toMatchObject({ kind: 'zone', price1: 64_000, price2: 63_500 })
  })

  test('milliseconds in a batch item fold to seconds', () => {
    const wire = buildChartDrawings(
      input({ drawings: [{ drawing_kind: 'vline', time: 1_700_000_000_000 }] }),
    )
    expect(wire[0]).toMatchObject({ kind: 'vline', time: 1_700_000_000 })
  })
})
