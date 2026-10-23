import { describe, expect, it } from 'bun:test'
import type { AgentToolExecutionContext, ToolCommandReplyOutcome } from '@localixai/agent/agents'
import { TRADING_CHART_CHANNEL, TRADING_MINI_APP, parseChartCommandPayload } from './chart-command'
import {
  buildChartCommandPayload,
  manageChartInputSchema,
  manageChartProblem,
  type ManageChartInput,
} from './manage-chart-schema'
import { createManageChartTool } from './manage-chart'
import type { MarketDataConnection } from './market-data-port'

const conn = (over: Partial<MarketDataConnection> = {}): MarketDataConnection => ({
  id: 'public:hyperliquid',
  name: 'hyperliquid (public market data)',
  exchangeId: 'hyperliquid',
  sandbox: false,
  readonly: true,
  connected: true,
  ...over,
})

/** A context whose emitCommand calls are captured — the tool's ONLY side effect. */
function recordingCtx() {
  const emitted: Array<{ plugin: string; channel: string; payload: unknown }> = []
  const ctx: AgentToolExecutionContext = {
    session: {
      id: 's-1',
      scratchDir: '/dev/null',
      emitCommand: (plugin, channel, payload) => emitted.push({ plugin, channel, payload }),
    },
  }
  return { ctx, emitted }
}

const input = (over: Partial<ManageChartInput>): ManageChartInput =>
  manageChartInputSchema.parse({ action: 'open', symbol: 'BTC/USDC:USDC', ...over })

const run = (
  i: ManageChartInput,
  ctx?: AgentToolExecutionContext,
  conns: MarketDataConnection[] = [conn()],
) =>
  createManageChartTool({ port: { listConnections: async () => conns } }).execute(
    't',
    i,
    undefined,
    undefined,
    ctx,
  )

describe('manage_chart schema — per-action fix-it validation', () => {
  it('declares that runtime dispatch requires the workbench UI capability', () => {
    const tool = createManageChartTool({ port: { listConnections: async () => [conn()] } })
    expect(tool.availability).toEqual({ requiredCapabilities: ['workbench-ui'] })
  })

  it('open needs nothing beyond the symbol', () => {
    expect(manageChartProblem(input({ action: 'open' }))).toBeNull()
  })

  it('set_timeframe without a timeframe names the missing field with examples', () => {
    expect(manageChartProblem(input({ action: 'set_timeframe' }))).toContain('"timeframe"')
    expect(manageChartProblem(input({ action: 'set_timeframe', timeframe: '1h' }))).toBeNull()
  })

  it('a non-timeframe string is refused with the accepted shape', () => {
    expect(manageChartProblem(input({ action: 'set_timeframe', timeframe: 'hourly' }))).toContain(
      'not a timeframe',
    )
  })

  it('set_indicators without indicators points at indicators_mode="clear" as the empty form', () => {
    const msg = manageChartProblem(input({ action: 'set_indicators' }))
    expect(msg).toContain('indicators')
    expect(msg).toContain('clear')
    expect(
      manageChartProblem(input({ action: 'set_indicators', indicators_mode: 'clear' })),
    ).toBeNull()
  })

  it('an unknown indicator spec is named in the fix-it, with the accepted forms', () => {
    const msg = manageChartProblem(
      input({ action: 'set_indicators', indicators: ['ema:200', 'zigzag'] }),
    )
    expect(msg).toContain('"zigzag"')
    expect(msg).toContain('macd:<fast>:<slow>:<signal>')
    expect(
      manageChartProblem(input({ action: 'set_indicators', indicators: ['ema:200', 'sma20'] })),
    ).toBeNull()
    // The six new kinds are ACCEPTED specs now, not fix-it material.
    expect(
      manageChartProblem(
        input({
          action: 'set_indicators',
          indicators: ['vwap', 'supertrend:10:3', 'stoch:14:3:3', 'atr:14', 'obv', 'adx:14'],
        }),
      ),
    ).toBeNull()
  })

  it('configure must name what it changes, and a range must be a range', () => {
    const configure = (over: Partial<ManageChartInput>) =>
      manageChartProblem(input({ action: 'configure', ...over }))
    // Neither an indicator nor a scale mode: the UI would silently drop it.
    expect(configure({})).toContain('needs either an "indicator"')
    expect(configure({ visible: false })).toContain('needs either an "indicator"')
    // Visual fields alongside a scale mode, but with nothing to apply them TO.
    expect(configure({ scale_mode: 'log', visible: false })).toContain(
      'needs an "indicator" to apply those fields to',
    )
    expect(configure({ indicator: 'zigzag', visible: false })).toContain('"zigzag"')
    // An indicator named with no change is a no-op, not an act.
    expect(configure({ indicator: 'rsi:14' })).toContain('no change')
    expect(configure({ indicator: 'rsi:14', range_min: 0 })).toContain('BOTH')
    expect(configure({ indicator: 'rsi:14', range_min: 100, range_max: 0 })).toContain('BELOW')
    expect(
      configure({ indicator: 'rsi:14', range_min: 0, range_max: 100, range_auto: true }),
    ).toContain('opposites')
    expect(configure({ indicator: 'ema:20', color: 'blue' })).toContain('not a hex color')
    // The well-formed calls.
    expect(configure({ scale_mode: 'log' })).toBeNull()
    expect(configure({ indicator: 'rsi14', range_min: 0, range_max: 100 })).toBeNull()
    expect(configure({ indicator: 'ema:200', visible: false })).toBeNull()
    expect(configure({ indicator: 'ema:200', color: '#6aa8ff' })).toBeNull()
  })

  it('buildChartCommandPayload canonicalizes the configure indicator id', () => {
    const payload = buildChartCommandPayload(
      input({ action: 'configure', indicator: 'RSI 14', visible: false, scale_mode: 'log' }),
      'public:hyperliquid',
    )
    expect(payload.configure).toEqual({ indicator: 'rsi:14', visible: false, scaleMode: 'log' })
    // The block rides only on `configure` — other actions never carry it.
    expect(buildChartCommandPayload(input({ action: 'open' }), 'c').configure).toBeUndefined()
  })

  it('set_chart_type needs chart_type; navigate needs its op; to_time needs time', () => {
    expect(manageChartProblem(input({ action: 'set_chart_type' }))).toContain('chart_type')
    expect(manageChartProblem(input({ action: 'set_chart_type', chart_type: 'line' }))).toBeNull()
    expect(manageChartProblem(input({ action: 'navigate' }))).toContain('navigate')
    expect(manageChartProblem(input({ action: 'navigate', navigate: 'to_time' }))).toContain(
      '"time"',
    )
    expect(
      manageChartProblem(input({ action: 'navigate', navigate: 'to_time', time: 1_700_000_000 })),
    ).toBeNull()
    expect(manageChartProblem(input({ action: 'navigate', navigate: 'zoom_in' }))).toBeNull()
  })

  it('the schema itself refuses an unknown action or chart_type', () => {
    expect(manageChartInputSchema.safeParse({ action: 'doodle', symbol: 'X/Y' }).success).toBe(
      false,
    )
    expect(
      manageChartInputSchema.safeParse({
        action: 'set_chart_type',
        symbol: 'X/Y',
        chart_type: 'heikin',
      }).success,
    ).toBe(false)
  })
})

describe('buildChartCommandPayload', () => {
  it('normalizes indicator spellings to canonical ids and dedupes them', () => {
    const payload = buildChartCommandPayload(
      input({ action: 'set_indicators', indicators: ['EMA 200', 'ema:200', 'bb20'] }),
      'public:hyperliquid',
    )
    expect(payload.indicators).toEqual(['ema:200', 'bb:20:2'])
    expect(payload.indicatorsMode).toBe('set')
  })

  it('folds a milliseconds time to seconds (agents copy Date.now())', () => {
    const ms = 1_700_000_000_123
    const payload = buildChartCommandPayload(
      input({ action: 'navigate', navigate: 'to_time', time: ms }),
      'c1',
    )
    expect(payload.time).toBe(1_700_000_000)
  })

  it('emits a payload the UI-side guard accepts (the two ends stay in contract)', () => {
    const payload = buildChartCommandPayload(
      input({ action: 'open', timeframe: '4h', indicators: ['rsi14'], chart_type: 'area' }),
      'public:hyperliquid',
    )
    expect(parseChartCommandPayload(payload)).toEqual(payload)
  })
})

describe('manage_chart execute — the emitCommand contract', () => {
  it('emits the command on the trading/chart command channel and narrates it', async () => {
    const { ctx, emitted } = recordingCtx()
    const result = await run(
      input({ action: 'set_timeframe', timeframe: '15m', connection_id: 'public:hyperliquid' }),
      ctx,
    )
    expect(result.isError).toBeUndefined()
    expect(emitted).toHaveLength(1)
    expect(emitted[0]!.plugin).toBe(TRADING_MINI_APP)
    expect(emitted[0]!.channel).toBe(TRADING_CHART_CHANNEL)
    expect(emitted[0]!.payload).toEqual({
      action: 'set_timeframe',
      connectionId: 'public:hyperliquid',
      symbol: 'BTC/USDC:USDC',
      timeframe: '15m',
    })
    expect(result.content).toContain('15m')
    expect(result.content).toContain('BTC/USDC:USDC')
  })

  it('defaults to the public venue when connection_id is omitted', async () => {
    const { ctx, emitted } = recordingCtx()
    await run(input({ action: 'open' }), ctx)
    expect((emitted[0]!.payload as { connectionId: string }).connectionId).toBe(
      'public:hyperliquid',
    )
  })

  it('an unknown connection is refused with the available options, and nothing is emitted', async () => {
    const { ctx, emitted } = recordingCtx()
    const result = await run(input({ action: 'open', connection_id: 'nope' }), ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('hyperliquid (public market data)')
    expect(emitted).toHaveLength(0)
  })

  it('a validation problem returns the fix-it and emits nothing', async () => {
    const { ctx, emitted } = recordingCtx()
    const result = await run(input({ action: 'set_timeframe' }), ctx)
    expect(result.isError).toBe(true)
    expect(emitted).toHaveLength(0)
  })

  it('without a session channel it says the chart is unreachable rather than pretending', async () => {
    const result = await run(input({ action: 'open' }), {})
    expect(result.isError).toBe(true)
    expect(result.content).toContain('no UI command channel')
  })

  it('a host without emitCommand (old session seam) is refused the same way', async () => {
    const result = await run(input({ action: 'open' }), {
      session: { id: 's-1', scratchDir: '/dev/null' },
    })
    expect(result.isError).toBe(true)
    expect(result.content).toContain('no UI command channel')
  })

  it('back-to-back calls each emit their own command (the stream is non-coalescing)', async () => {
    const { ctx, emitted } = recordingCtx()
    const tool = createManageChartTool({ port: { listConnections: async () => [conn()] } })
    await tool.execute('t1', input({ action: 'open' }), undefined, undefined, ctx)
    await tool.execute(
      't2',
      input({ action: 'set_chart_type', chart_type: 'line' }),
      undefined,
      undefined,
      ctx,
    )
    expect(emitted).toHaveLength(2)
  })

  it('asking for volume as an indicator is answered honestly — it is built in', async () => {
    const { ctx } = recordingCtx()
    const result = await run(
      input({ action: 'set_indicators', indicators: ['volume', 'ema:20'], indicators_mode: 'add' }),
      ctx,
    )
    expect(result.content).toContain('always shown')
  })
})

describe('manage_chart snapshot — the awaited read-back', () => {
  const snapshotReply = {
    mounted: true,
    connectionId: 'public:hyperliquid',
    symbol: 'BTC/USDC:USDC',
    timeframe: '4h',
    chartType: 'candles' as const,
    indicators: ['ema:200'],
    visibleRange: { from: 1_700_000_000, to: 1_700_360_000 },
    lastCandle: { time: 1_700_360_000, close: 64_000 },
  }

  /** A context whose emitCommandWithReply resolves with a canned outcome. */
  function replyingCtx(outcome: ToolCommandReplyOutcome) {
    const awaited: Array<{ plugin: string; channel: string; payload: unknown }> = []
    const ctx: AgentToolExecutionContext = {
      session: {
        id: 's-1',
        scratchDir: '/dev/null',
        emitCommand: () => {
          throw new Error('snapshot must use the awaited path, never fire-and-forget')
        },
        emitCommandWithReply: async (plugin, channel, payload) => {
          awaited.push({ plugin, channel, payload })
          return outcome
        },
      },
    }
    return { ctx, awaited }
  }

  it('the schema accepts action="snapshot" with just a symbol', () => {
    expect(manageChartInputSchema.safeParse({ action: 'snapshot', symbol: 'X/Y' }).success).toBe(
      true,
    )
    expect(manageChartProblem(input({ action: 'snapshot' }))).toBeNull()
  })

  it("awaits the reply and reports the chart's actual state (resolve path)", async () => {
    const { ctx, awaited } = replyingCtx({ ok: true, result: snapshotReply })
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.isError).toBeUndefined()
    expect(awaited).toHaveLength(1)
    expect(awaited[0]).toMatchObject({
      plugin: TRADING_MINI_APP,
      channel: TRADING_CHART_CHANNEL,
      payload: {
        action: 'snapshot',
        connectionId: 'public:hyperliquid',
        symbol: 'BTC/USDC:USDC',
      },
    })
    expect(result.content).toContain('tab is open')
    expect(result.content).toContain('timeframe: 4h')
    expect(result.content).toContain('ema:200')
    expect(result.content).toContain('close 64000')
    // Live-state read: a later snapshot of the same chart supersedes this one.
    expect(result.supersedeKey).toBe('trading:chart:public:hyperliquid:BTC/USDC:USDC')
  })

  it('a timeout is an honest "no reply", not an error crash', async () => {
    const { ctx } = replyingCtx({ ok: false, noReply: true, error: 'No reply from the UI …' })
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('No reply from the UI')
    expect(result.content).toContain('Nothing was opened or changed')
  })

  it('an explicit sink failure is relayed verbatim', async () => {
    const { ctx } = replyingCtx({ ok: false, error: 'store unavailable' })
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('store unavailable')
  })

  it('a malformed reply shape is refused rather than passed to the model as fact', async () => {
    const { ctx } = replyingCtx({ ok: true, result: { totally: 'wrong' } })
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('unrecognized snapshot shape')
  })

  it('a host without the reply seam says so honestly (old emitCommand-only session)', async () => {
    const { ctx } = recordingCtx()
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.isError).toBe(true)
    expect(result.content).toContain('no UI reply channel')
  })

  it('an unmounted reply narrates prefs-only state without claiming the tab is open', async () => {
    const { ctx } = replyingCtx({
      ok: true,
      result: { mounted: false, connectionId: 'public:hyperliquid', symbol: 'BTC/USDC:USDC' },
    })
    const result = await run(input({ action: 'snapshot' }), ctx)
    expect(result.content).toContain('NOT open')
    expect(result.content).toContain('nothing was opened')
  })
})

describe('parseChartCommandPayload — the sink-side guard', () => {
  it('drops malformed payloads instead of crashing the stream router', () => {
    expect(parseChartCommandPayload(null)).toBeNull()
    expect(parseChartCommandPayload('open')).toBeNull()
    expect(parseChartCommandPayload({ action: 'open' })).toBeNull() // no connection/symbol
    expect(
      parseChartCommandPayload({ action: 'open', connectionId: 'c', symbol: 's', chartType: 'x' }),
    ).toBeNull()
    expect(
      parseChartCommandPayload({ action: 'open', connectionId: 'c', symbol: 's', indicators: [1] }),
    ).toBeNull()
  })
})

describe('manage_chart detect — server-side pattern scan', () => {
  const candles = (() => {
    const cycle = [100, 104, 108, 104, 100, 96, 92, 96]
    const closes = [...cycle, ...cycle, ...cycle, 100]
    return closes.map((close, i) => ({
      time: 1_700_000_000 + i * 3600,
      open: close,
      high: close === 108 ? 110 : close + 1,
      low: close === 92 ? 90 : close - 1,
      close,
      volume: 10,
    }))
  })()

  const detectTool = (ohlcv?: () => Promise<typeof candles>) =>
    createManageChartTool({
      port: {
        listConnections: async () => [conn()],
        ...(ohlcv ? { ohlcv } : {}),
      },
    })

  it('returns levels/trend/flags WITH NUMBERS, without any UI channel', async () => {
    const result = await detectTool(async () => candles).execute(
      't',
      input({ action: 'detect' }),
      undefined,
      undefined,
      undefined, // no context at all — detect must not need the UI
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('support @ 90')
    expect(result.content).toContain('resistance @ 110')
    expect(result.content).toContain('pivot touches')
  })

  it('auto_draw emits standard draw commands with stable pat-*/fib-* ids', async () => {
    const { ctx, emitted } = recordingCtx()
    const result = await detectTool(async () => candles).execute(
      't',
      input({ action: 'detect', auto_draw: true }),
      undefined,
      undefined,
      ctx,
    )
    expect(result.isError).toBeUndefined()
    expect(emitted.length).toBeGreaterThan(0)
    // A readable chart beats an exhaustive one — auto_draw is capped so it never floods.
    expect(emitted.length).toBeLessThanOrEqual(10)
    for (const e of emitted) {
      const payload = parseChartCommandPayload(e.payload)
      expect(payload).not.toBeNull()
      expect(payload!.action).toBe('draw')
      // Stable, source-prefixed ids so a re-detect replaces its own overlays: pivots/trend `pat-*`,
      // Fibonacci `fib-*`, gaps `fvg-*`, structure `struct-*`, volume `vol-*`, session VWAP `vwap-*`.
      expect(payload!.drawing!.id).toMatch(/^(pat|fib|fvg|struct|vol|vwap)-/)
    }
    expect(result.content).toContain('Drawn on the chart')
  })

  it('detail="compact" keeps the decision core, drops the grids, and says what it omitted', async () => {
    const full = await detectTool(async () => candles).execute(
      't',
      input({ action: 'detect' }),
      undefined,
      undefined,
      undefined,
    )
    const compact = await detectTool(async () => candles).execute(
      't',
      input({ action: 'detect', detail: 'compact' }),
      undefined,
      undefined,
      undefined,
    )
    expect(compact.isError).toBeUndefined()
    // Meaningfully smaller, core intact, the omission named.
    expect(compact.content.length).toBeLessThan(full.content.length * 0.8)
    expect(compact.content).toContain('composite signal')
    expect(compact.content).toContain('compact scan')
    // Grid blocks are full-only.
    expect(full.content).toContain('fib retracement')
    expect(compact.content).not.toContain('fib retracement')
    expect(compact.content).not.toContain('pivot')
  })

  it('is honest when no candle reader is wired, and when the venue read fails', async () => {
    const noReader = await detectTool().execute(
      't',
      input({ action: 'detect' }),
      undefined,
      undefined,
      undefined,
    )
    expect(noReader.isError).toBe(true)
    expect(noReader.content).toContain('no candle reader')

    const failing = await detectTool(async () => {
      throw new Error('venue unreachable')
    }).execute('t', input({ action: 'detect' }), undefined, undefined, undefined)
    expect(failing.isError).toBe(true)
    expect(failing.content).toContain('venue unreachable')
  })

  it('validates the timeframe form for detect like the other actions', () => {
    expect(manageChartProblem(input({ action: 'detect', timeframe: 'often' }))).toContain(
      'not a timeframe',
    )
    expect(manageChartProblem(input({ action: 'detect', timeframe: '4h' }))).toBeNull()
  })
})

describe('manage_chart detect — funding + order-book reads', () => {
  const richTool = (calls: string[]) =>
    createManageChartTool({
      port: {
        listConnections: async () => [conn()],
        ohlcv: async () => candlesFor(),
        funding: async () => {
          calls.push('funding')
          // 0.06%/8h — extreme long crowding, a LIVE event compact must keep.
          return { symbol: 'S', rate: 0.0006, interval: '8h' }
        },
        orderBook: async (_id, _s, limit) => {
          calls.push(`book:${limit}`)
          return {
            symbol: 'S',
            bids: [[99.9, 5] as [number, number]],
            asks: [[100.1, 1] as [number, number]],
          }
        },
      },
    })
  // A local alias — the outer describe's fixture is scoped there.
  const candlesFor = () => {
    const cycle = [100, 104, 108, 104, 100, 96, 92, 96]
    const closes = [...cycle, ...cycle, ...cycle, 100]
    return closes.map((close, i) => ({
      time: 1_700_000_000 + i * 3600,
      open: close,
      high: close === 108 ? 110 : close + 1,
      low: close === 92 ? 90 : close - 1,
      close,
      volume: 10,
    }))
  }

  it('full detect prints both lines; the reads are best-effort in parallel', async () => {
    const calls: string[] = []
    const result = await richTool(calls).execute(
      't',
      input({ action: 'detect' }),
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('funding: +0.0600%/8h')
    expect(result.content).toContain('EXTREME long crowding')
    expect(result.content).toContain('order book (top 1)')
    expect(calls).toContain('funding')
    expect(calls).toContain('book:10')
  })

  it('compact keeps crowded funding (a live event) but never FETCHES the book it will not print', async () => {
    const calls: string[] = []
    const result = await richTool(calls).execute(
      't',
      input({ action: 'detect', detail: 'compact' }),
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).toContain('EXTREME long crowding')
    expect(result.content).not.toContain('order book')
    expect(calls).toContain('funding')
    expect(calls.some((c) => c.startsWith('book'))).toBe(false)
  })

  it('a spot market (funding read throws) simply omits the positioning line', async () => {
    const tool = createManageChartTool({
      port: {
        listConnections: async () => [conn()],
        ohlcv: async () => candlesFor(),
        funding: async () => {
          throw new Error('spot market has no funding')
        },
      },
    })
    const result = await tool.execute(
      't',
      input({ action: 'detect' }),
      undefined,
      undefined,
      undefined,
    )
    expect(result.isError).toBeUndefined()
    expect(result.content).not.toContain('funding:')
  })
})
