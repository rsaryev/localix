import { describe, expect, test } from 'bun:test'
import '@localixai/kit/testing/host-runtime'
import { registerInspectorHandler } from '@localixai/kit/testing'
import type { MiniAppCommandEvent } from '@localixai/mini-app-sdk/ui/commands'
import type { ChartCommandPayload } from '../../backend/chart-command'
import { chartControlBus, type ChartControlCommand } from './chartControlBus'
import { chartStateStore } from './chartStateStore'
import { handleChartCommandEvent, planChartCommand } from './agentChartCommands'
import { tradingChartTabId } from './openTab'

const payload = (over: Partial<ChartCommandPayload>): ChartCommandPayload => ({
  action: 'open',
  connectionId: 'public:hyperliquid',
  symbol: 'BTC/USDC:USDC',
  ...over,
})

describe('planChartCommand — wire payload → open + bus commands', () => {
  test('every plan opens/focuses the tab under the SAME id formula the sidebar uses', () => {
    const plan = planChartCommand(payload({}))
    expect(plan.tabId).toBe('trading:chart:public:hyperliquid:BTC%2FUSDC%3AUSDC')
    expect(plan.open).toEqual({
      connectionId: 'public:hyperliquid',
      symbol: 'BTC/USDC:USDC',
      exchangeId: 'hyperliquid',
      name: 'BTC/USDC:USDC · hyperliquid',
    })
  })

  test('configure decomposes into the CHART scale command and the INDICATOR patch', () => {
    const plan = planChartCommand(
      payload({
        action: 'configure',
        configure: {
          indicator: 'rsi:14',
          visible: false,
          color: '#6aa8ff',
          rangeMin: 0,
          rangeMax: 100,
          scaleMode: 'log',
        },
      }),
    )
    expect(plan.commands).toEqual([
      { type: 'set_scale_mode', mode: 'log' },
      {
        type: 'configure_indicator',
        id: 'rsi:14',
        // `visible: false` IS `hidden: true` — the prefs speak in hidden.
        patch: { hidden: true, color: '#6aa8ff', range: { min: 0, max: 100 } },
      },
    ])
  })

  test('a scale-mode-only configure patches no indicator; a half range is not a range', () => {
    expect(
      planChartCommand(payload({ action: 'configure', configure: { scaleMode: 'percentage' } }))
        .commands,
    ).toEqual([{ type: 'set_scale_mode', mode: 'percentage' }])
    // An indicator named with nothing to change produces no patch command at all.
    expect(
      planChartCommand(
        payload({ action: 'configure', configure: { indicator: 'rsi:14', scaleMode: 'log' } }),
      ).commands,
    ).toEqual([{ type: 'set_scale_mode', mode: 'log' }])
    // rangeMin without rangeMax cannot make a range (the tool fix-its it; the plan drops it).
    expect(
      planChartCommand(
        payload({ action: 'configure', configure: { indicator: 'rsi:14', rangeMin: 0 } }),
      ).commands,
    ).toEqual([])
  })

  test('rangeAuto clears the fixed range', () => {
    expect(
      planChartCommand(
        payload({ action: 'configure', configure: { indicator: 'rsi:14', rangeAuto: true } }),
      ).commands,
    ).toEqual([{ type: 'configure_indicator', id: 'rsi:14', patch: { rangeAuto: true } }])
  })

  test('a bare open carries no commands — opening IS the command', () => {
    expect(planChartCommand(payload({})).commands).toEqual([])
  })

  test('an open with extras decomposes into one command per concern, ordered', () => {
    const plan = planChartCommand(
      payload({
        timeframe: '4h',
        indicators: ['ema:200'],
        indicatorsMode: 'set',
        chartType: 'area',
        navigate: 'to_realtime',
      }),
    )
    expect(plan.commands).toEqual([
      { type: 'set_timeframe', timeframe: '4h' },
      { type: 'set_indicators', mode: 'set', ids: ['ema:200'] },
      { type: 'set_chart_type', chartType: 'area' },
      { type: 'navigate', op: 'to_realtime' },
    ])
  })

  test('indicators_mode=clear becomes a clear command even with no ids on the wire', () => {
    const plan = planChartCommand(payload({ action: 'set_indicators', indicatorsMode: 'clear' }))
    expect(plan.commands).toEqual([{ type: 'set_indicators', mode: 'clear', ids: [] }])
  })

  test('navigate to_time carries its time through', () => {
    const plan = planChartCommand(
      payload({ action: 'navigate', navigate: 'to_time', time: 1_700_000_000 }),
    )
    expect(plan.commands).toEqual([{ type: 'navigate', op: 'to_time', time: 1_700_000_000 }])
  })

  test('a NON-public connection keeps its id as the venue name and claims no exchangeId', () => {
    const plan = planChartCommand(payload({ connectionId: 'conn-1' }))
    expect(plan.open.exchangeId).toBeUndefined()
    expect(plan.open.name).toBe('BTC/USDC:USDC · conn-1')
  })
})

const commandEvent = (over: Partial<MiniAppCommandEvent>): MiniAppCommandEvent => ({
  sessionId: 's-1',
  active: true,
  payload: payload({ action: 'set_timeframe', timeframe: '4h' }),
  commandId: `cmd-${Math.random()}`,
  seq: 1,
  ...over,
})

describe('handleChartCommandEvent — the sink + placement policy', () => {
  test('a command opens/focuses the chart IN the issuing chat and publishes its state changes', () => {
    const opened: unknown[] = []
    const unregister = registerInspectorHandler((req) => opened.push(req))
    const received: ChartControlCommand[] = []
    const tabId = tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')
    const unsubscribe = chartControlBus.subscribe('s-1', tabId, (c) => received.push(c))
    try {
      handleChartCommandEvent(commandEvent({ active: true }))
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatchObject({
        kind: 'work-item',
        workKind: 'trading:chart',
        id: tabId,
        scope: 's-1',
      })
      expect(received).toEqual([{ type: 'set_timeframe', timeframe: '4h' }])
    } finally {
      unsubscribe()
      unregister()
    }
  })

  test("chat A's agent command never reaches chat B's chart of the same market", () => {
    // Both chats hold BTC. Keyed by market alone, A's `set_timeframe` also moved B's chart.
    const unregister = registerInspectorHandler(() => {})
    const tabId = tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')
    const inA: ChartControlCommand[] = []
    const inB: ChartControlCommand[] = []
    const offA = chartControlBus.subscribe('chat-a', tabId, (c) => inA.push(c))
    const offB = chartControlBus.subscribe('chat-b', tabId, (c) => inB.push(c))
    try {
      handleChartCommandEvent(commandEvent({ sessionId: 'chat-a', active: false }))
      expect(inA).toEqual([{ type: 'set_timeframe', timeframe: '4h' }])
      expect(inB).toEqual([])
    } finally {
      offA()
      offB()
      unregister()
    }
  })

  test('a BACKGROUND chat’s command opens in THAT chat, never the one on screen', () => {
    // The chart is a session tab: opening it in the issuing chat cannot put it in front of the
    // chat being read, and skipping the open dropped the command once the bus buffer expired.
    const opened: unknown[] = []
    const unregister = registerInspectorHandler((req) => opened.push(req))
    const received: ChartControlCommand[] = []
    const tabId = tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')
    const unsubscribe = chartControlBus.subscribe('s-background', tabId, (c) => received.push(c))
    try {
      handleChartCommandEvent(commandEvent({ active: false, sessionId: 's-background' }))
      expect(opened).toHaveLength(1)
      expect(opened[0]).toMatchObject({ workKind: 'trading:chart', scope: 's-background' })
      expect(received).toEqual([{ type: 'set_timeframe', timeframe: '4h' }])
    } finally {
      unsubscribe()
      unregister()
      chartControlBus._clearBuffered()
    }
  })

  test('a malformed payload is dropped silently (never throws into the stream router)', () => {
    const opened: unknown[] = []
    const unregister = registerInspectorHandler((req) => opened.push(req))
    try {
      expect(() =>
        handleChartCommandEvent(commandEvent({ payload: { action: 'open' } })),
      ).not.toThrow()
      expect(opened).toHaveLength(0)
    } finally {
      unregister()
    }
  })
})

describe('handleChartCommandEvent — snapshot (read-only round-trip)', () => {
  const snapshotEvent = (over: Partial<MiniAppCommandEvent>): MiniAppCommandEvent =>
    commandEvent({ payload: payload({ action: 'snapshot' }), ...over })

  test('replies with the tab state and NEVER opens/focuses — even from the active session', () => {
    const opened: unknown[] = []
    const unregister = registerInspectorHandler((req) => opened.push(req))
    const tabId = tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')
    chartStateStore.patch('s-1', tabId, { mounted: true, timeframe: '4h', chartType: 'area' })
    const replies: unknown[] = []
    try {
      handleChartCommandEvent(snapshotEvent({ active: true, reply: (r) => replies.push(r) }))
      expect(opened).toHaveLength(0)
      expect(replies).toEqual([
        {
          ok: true,
          result: {
            mounted: true,
            connectionId: 'public:hyperliquid',
            symbol: 'BTC/USDC:USDC',
            timeframe: '4h',
            chartType: 'area',
          },
        },
      ])
    } finally {
      unregister()
      chartStateStore._clear()
    }
  })

  test('a snapshot publishes NOTHING onto the control bus (read-only by contract)', () => {
    const received: ChartControlCommand[] = []
    const tabId = tradingChartTabId('public:hyperliquid', 'BTC/USDC:USDC')
    const unsubscribe = chartControlBus.subscribe('s-1', tabId, (c) => received.push(c))
    try {
      handleChartCommandEvent(snapshotEvent({ reply: () => {} }))
      expect(received).toEqual([])
    } finally {
      unsubscribe()
      chartStateStore._clear()
    }
  })

  test('an unopened tab answers mounted:false (prefs), and a missing reply seam never throws', () => {
    const replies: Array<{ ok: boolean; result?: unknown }> = []
    try {
      handleChartCommandEvent(snapshotEvent({ reply: (r) => replies.push(r) }))
      expect(replies[0]).toMatchObject({ ok: true, result: { mounted: false } })
      // A frame with no reply seam (fire-and-forget host) is simply a no-op.
      expect(() => handleChartCommandEvent(snapshotEvent({}))).not.toThrow()
    } finally {
      chartStateStore._clear()
    }
  })
})

describe('planChartCommand — draw payloads', () => {
  test('an add maps to ONE draw command carrying the drawing', () => {
    const plan = planChartCommand(
      payload({
        action: 'draw',
        drawMode: 'add',
        drawing: { kind: 'hline', price: 65_000, color: '#ff9900' },
      }),
    )
    expect(plan.commands).toEqual([
      { type: 'draw', mode: 'add', drawing: { kind: 'hline', price: 65_000, color: '#ff9900' } },
    ])
  })

  test('remove carries the id; clear carries the mode alone', () => {
    expect(
      planChartCommand(payload({ action: 'draw', drawMode: 'remove', drawingId: 'd2' })).commands,
    ).toEqual([{ type: 'draw', mode: 'remove', id: 'd2' }])
    expect(planChartCommand(payload({ action: 'draw', drawMode: 'clear' })).commands).toEqual([
      { type: 'draw', mode: 'clear' },
    ])
  })
})
