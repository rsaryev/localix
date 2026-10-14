import { describe, expect, test } from 'bun:test'
import { rowReasoning } from './rowReasoning'

/**
 * The defect this pins, in one sentence: raising the level on the model you are USING repainted
 * every other row with it, because a row with no choice of its own showed the carried level as
 * though it had been chosen for that model.
 */
describe('a model row shows a choice or an inheritance, never one as the other', () => {
  test('a model nobody set a level for shows what it would inherit, not a choice', () => {
    expect(
      rowReasoning({ selected: false, chosen: 'high', saved: undefined, carried: 'high' }),
    ).toEqual({ value: undefined, inherited: 'high' })
  })

  test('a model set by hand keeps its own level while the session moves', () => {
    // The session is on `high`; this model was set to `low` once and stays there.
    expect(
      rowReasoning({ selected: false, chosen: 'high', saved: 'low', carried: 'high' }),
    ).toEqual({ value: 'low', inherited: 'high' })
  })

  test('the chat’s own row states the level the seat holds', () => {
    expect(
      rowReasoning({ selected: true, chosen: 'max', saved: undefined, carried: 'medium' }),
    ).toEqual({ value: 'max', inherited: undefined })
  })

  test('a seat that holds nothing inherits too, rather than claiming a level', () => {
    expect(
      rowReasoning({ selected: true, chosen: undefined, saved: undefined, carried: 'medium' }),
    ).toEqual({ value: undefined, inherited: 'medium' })
  })

  test('a workload row keeps its way back to the session’s level while it holds an override', () => {
    // Title generation and the other workloads — their rows offer "follow the chat", which is the click that
    // drops the override, so the fallback is present even when a choice is.
    expect(
      rowReasoning({
        selected: true,
        chosen: 'low',
        saved: undefined,
        carried: 'medium',
        sessionFallback: 'high',
      }),
    ).toEqual({ value: 'low', inherited: 'high' })
  })
})
