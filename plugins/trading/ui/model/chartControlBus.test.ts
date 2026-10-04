import { beforeEach, describe, expect, test } from 'bun:test'
import { chartControlBus, type ChartControlCommand } from './chartControlBus'

const tf = (timeframe: string): ChartControlCommand => ({ type: 'set_timeframe', timeframe })

let keySeq = 0
/** A fresh key per test — the bus is a module singleton, so tests must not share addresses. */
const freshKey = () => `tab-${++keySeq}`

/** The chat every keyed-delivery case below addresses; the cross-chat case names its own two. */
const CHAT = 'chat-a'

beforeEach(() => chartControlBus._clearBuffered())

describe('chartControlBus — keyed delivery', () => {
  test("a command for chat A's chart of a market never reaches chat B's chart of it", () => {
    // Two chats each hold a BTC chart. Keyed by market alone, chat A's agent setting the
    // timeframe also moved chat B's chart, kept warm in the background.
    const btc = freshKey()
    const gotA: ChartControlCommand[] = []
    const gotB: ChartControlCommand[] = []
    const offA = chartControlBus.subscribe('chat-a', btc, (c) => gotA.push(c))
    const offB = chartControlBus.subscribe('chat-b', btc, (c) => gotB.push(c))
    chartControlBus.publish('chat-a', btc, tf('4h'))
    expect(gotA).toEqual([tf('4h')])
    expect(gotB).toEqual([])
    offA()
    offB()
  })

  test("a buffered command replays only into its own chat's chart", () => {
    const btc = freshKey()
    chartControlBus.publish('chat-a', btc, tf('1d'))
    const gotB: ChartControlCommand[] = []
    const offB = chartControlBus.subscribe('chat-b', btc, (c) => gotB.push(c))
    const gotA: ChartControlCommand[] = []
    const offA = chartControlBus.subscribe('chat-a', btc, (c) => gotA.push(c))
    expect(gotB).toEqual([])
    expect(gotA).toEqual([tf('1d')])
    offA()
    offB()
  })

  test('a command reaches every listener on ITS key and nobody else', () => {
    const a = freshKey()
    const b = freshKey()
    const gotA: ChartControlCommand[] = []
    const gotA2: ChartControlCommand[] = []
    const gotB: ChartControlCommand[] = []
    const offA = chartControlBus.subscribe(CHAT, a, (c) => gotA.push(c))
    const offA2 = chartControlBus.subscribe(CHAT, a, (c) => gotA2.push(c))
    const offB = chartControlBus.subscribe(CHAT, b, (c) => gotB.push(c))
    chartControlBus.publish(CHAT, a, tf('1h'))
    expect(gotA).toEqual([tf('1h')])
    expect(gotA2).toEqual([tf('1h')])
    expect(gotB).toEqual([])
    offA()
    offA2()
    offB()
  })

  test('unsubscribe stops delivery', () => {
    const key = freshKey()
    const got: ChartControlCommand[] = []
    const off = chartControlBus.subscribe(CHAT, key, (c) => got.push(c))
    off()
    chartControlBus.publish(CHAT, key, tf('1h'))
    expect(got).toEqual([])
  })

  test('a throwing listener does not break the fan-out', () => {
    const key = freshKey()
    const got: ChartControlCommand[] = []
    const off1 = chartControlBus.subscribe(CHAT, key, () => {
      throw new Error('boom')
    })
    const off2 = chartControlBus.subscribe(CHAT, key, (c) => got.push(c))
    chartControlBus.publish(CHAT, key, tf('4h'))
    expect(got).toEqual([tf('4h')])
    off1()
    off2()
  })
})

describe('chartControlBus — replay for the not-yet-mounted tab', () => {
  test('commands published before ANY listener replay to each subscriber that arrives', () => {
    // The real sequence: the sink opens the tab, then publishes — the lazy tab mounts a commit
    // later, and BOTH its listeners (tab: timeframe, canvas: the rest) need the batch.
    const key = freshKey()
    chartControlBus.publish(CHAT, key, tf('15m'))
    chartControlBus.publish(CHAT, key, { type: 'set_chart_type', chartType: 'line' })
    const canvas: ChartControlCommand[] = []
    const tab: ChartControlCommand[] = []
    const offCanvas = chartControlBus.subscribe(CHAT, key, (c) => canvas.push(c))
    const offTab = chartControlBus.subscribe(CHAT, key, (c) => tab.push(c))
    expect(canvas).toEqual([tf('15m'), { type: 'set_chart_type', chartType: 'line' }])
    expect(tab).toEqual(canvas)
    offCanvas()
    offTab()
  })

  test('live delivery does not buffer — a remounting tab sees no ghost of a delivered command', () => {
    const key = freshKey()
    const first: ChartControlCommand[] = []
    const off = chartControlBus.subscribe(CHAT, key, (c) => first.push(c))
    chartControlBus.publish(CHAT, key, tf('1d'))
    off()
    const second: ChartControlCommand[] = []
    const off2 = chartControlBus.subscribe(CHAT, key, (c) => second.push(c))
    expect(first).toEqual([tf('1d')])
    expect(second).toEqual([])
    off2()
  })

  test('the buffer is bounded — a flood keeps only the newest commands', () => {
    const key = freshKey()
    for (let i = 0; i < 40; i++) chartControlBus.publish(CHAT, key, tf(`${i}m`))
    const got: ChartControlCommand[] = []
    const off = chartControlBus.subscribe(CHAT, key, (c) => got.push(c))
    expect(got.length).toBe(16)
    expect(got.at(-1)).toEqual(tf('39m'))
    off()
  })
})
