import { describe, expect, test } from 'bun:test'
import { EMULATED_FALLBACK_MS, tickerPollPlan } from './tickerPoll'

const plan = (over: Partial<Parameters<typeof tickerPollPlan>[0]> = {}) =>
  tickerPollPlan({
    enabled: true,
    streamHasDelivered: false,
    emulated: false,
    intervalMs: 4000,
    ...over,
  })

describe('tickerPollPlan', () => {
  test('a native ticker polls at the caller’s interval and fires at mount', () => {
    expect(plan()).toEqual({ enabled: true, intervalMs: 4000, immediate: true })
  })

  test('an emulated ticker polls slowly and never fires at mount', () => {
    // Its read occupies the venue's serial queue for seconds; at mount it would starve the chart's
    // own history load, which is what the user actually opened.
    expect(plan({ emulated: true })).toEqual({
      enabled: true,
      intervalMs: EMULATED_FALLBACK_MS,
      immediate: false,
    })
  })

  test('an UNKNOWN cost polls not at all — the stream still feeds it', () => {
    // `undefined` is "capabilities have not loaded, or failed to". Guessing native here fires the
    // expensive read. An unknown cost is not a cheap one.
    const p = plan({ emulated: undefined })
    expect(p.enabled).toBe(false)
    expect(p.immediate).toBe(false)
  })

  test('a stream that has DELIVERED pauses the poll whatever the cost', () => {
    expect(plan({ streamHasDelivered: true }).enabled).toBe(false)
    expect(plan({ streamHasDelivered: true, emulated: true }).enabled).toBe(false)
  })

  test('a connected-but-silent stream does NOT pause the poll', () => {
    // The registry calls a stream `live` 800ms after its loop starts — that proves the socket
    // connected, not that this market prints. A quiet market would otherwise show no price at all.
    expect(plan({ streamHasDelivered: false }).enabled).toBe(true)
  })

  test('delivery is a claim about NOW — a dead stream must let the poll resume', () => {
    // The caller drops `streamHasDelivered` when the subscription goes down; the plan simply obeys.
    // Otherwise the first push disables the poll and the corpse keeps it disabled.
    expect(plan({ streamHasDelivered: false, emulated: true }).enabled).toBe(true)
  })

  test('a disabled caller polls nothing', () => {
    expect(plan({ enabled: false }).enabled).toBe(false)
  })
})
