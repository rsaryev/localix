import { describe, expect, test } from 'bun:test'
import {
  historyBudgetTokens,
  resolveContextBudgetFrame,
  scaledReserveTokens,
} from './context-budget'
import {
  CONTEXT_WINDOW_CAP,
  DEFAULT_CONTEXT_WINDOW,
  resolveContextWindow,
  resolveEffectiveContextWindow,
  resolveKeepRecentTokens,
  MODEL_TRIM_KEEP_RECENT_TOKENS,
  MODEL_TRIM_KEEP_RECENT_CAP,
} from './agent-runner-constants'
import { CHECKPOINT_HIGH_WATER } from './model-view/checkpoint-policy'

/** The whole-request ceiling the checkpoint policy and the in-run prune measure against. */
const ceilingOf = (effectiveWindow: number) =>
  resolveContextBudgetFrame({ contextWindow: effectiveWindow }).trigger

describe('resolveKeepRecentTokens (H2 — window-scaled keep-recent tail)', () => {
  test('falls back to the flat floor when the window is unknown / non-positive', () => {
    expect(resolveKeepRecentTokens(undefined)).toBe(MODEL_TRIM_KEEP_RECENT_TOKENS)
    expect(resolveKeepRecentTokens(0)).toBe(MODEL_TRIM_KEEP_RECENT_TOKENS)
    expect(resolveKeepRecentTokens(-1)).toBe(MODEL_TRIM_KEEP_RECENT_TOKENS)
  })

  test('keeps SMALL windows at the floor — zero regression vs the old flat 16384', () => {
    // 0.15 × 32k = 4800 < floor, 0.15 × 100k = 15000 < floor → still the floor.
    expect(resolveKeepRecentTokens(32_000)).toBe(MODEL_TRIM_KEEP_RECENT_TOKENS)
    expect(resolveKeepRecentTokens(100_000)).toBe(MODEL_TRIM_KEEP_RECENT_TOKENS)
  })

  test('scales mildly on large windows (0.15 × window)', () => {
    expect(resolveKeepRecentTokens(128_000)).toBe(19_200)
    expect(resolveKeepRecentTokens(200_000)).toBe(30_000)
  })

  test("caps at 65536 so a 1M window can't lock an absurd tail", () => {
    expect(resolveKeepRecentTokens(1_000_000)).toBe(MODEL_TRIM_KEEP_RECENT_CAP)
    expect(resolveKeepRecentTokens(2_000_000)).toBe(MODEL_TRIM_KEEP_RECENT_CAP)
  })

  test('never returns below the floor or above the cap for any window', () => {
    for (const cw of [1, 500, 50_000, 128_000, 400_000, 5_000_000]) {
      const v = resolveKeepRecentTokens(cw)
      expect(v).toBeGreaterThanOrEqual(MODEL_TRIM_KEEP_RECENT_TOKENS)
      expect(v).toBeLessThanOrEqual(MODEL_TRIM_KEEP_RECENT_CAP)
    }
  })
})

describe('resolveContextWindow — a missing catalog entry is not evidence of pressure', () => {
  test('an unknown window falls back to the conservative default, never 0', () => {
    // Budgeting against `undefined` put every threshold at zero — a checkpoint on every turn,
    // on every model the catalog does not carry (deepseek among them).
    expect(resolveContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolveContextWindow({})).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolveContextWindow({ contextLength: 0 })).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  test('a known window wins', () => {
    expect(resolveContextWindow({ contextLength: 1_000_000 })).toBe(1_000_000)
    expect(resolveContextWindow({ contextLength: 8_192 })).toBe(8_192)
  })

  test('invalid and fractional catalog values cannot leak into budget arithmetic', () => {
    expect(resolveContextWindow({ contextLength: Number.NaN })).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(resolveContextWindow({ contextLength: Number.POSITIVE_INFINITY })).toBe(
      DEFAULT_CONTEXT_WINDOW,
    )
    expect(resolveContextWindow({ contextLength: 32_000.9 })).toBe(32_000)
  })

  test('the fallback keeps the checkpoint mark and the protected tail above zero', () => {
    const cw = resolveEffectiveContextWindow(undefined)
    expect(Math.floor(ceilingOf(cw) * CHECKPOINT_HIGH_WATER)).toBeGreaterThan(0)
    expect(resolveKeepRecentTokens(cw)).toBeGreaterThan(0)
  })
})

/**
 * The BUDGET (what a request must fit under) uses the CAPPED window, so a 1M-context model is
 * not promised 900k of history it is never allowed to reach, and every request stays bounded.
 */
describe('the history budget and the request ceiling', () => {
  const WINDOWS = [8_000, 32_000, 64_000, 128_000, 200_000, 262_144, 400_000, 1_000_000, 2_000_000]

  test('the effective window is the real one, capped', () => {
    expect(resolveEffectiveContextWindow({ contextLength: 1_000_000 })).toBe(CONTEXT_WINDOW_CAP)
    expect(resolveEffectiveContextWindow({ contextLength: 32_000 })).toBe(32_000)
    expect(resolveEffectiveContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
  })

  /**
   * This once asserted `x <= x` (both sides the same expression) and could not go red. It
   * calls the production functions themselves, so a formula change moves the assertion.
   */
  test('the budget never promises more than the request ceiling allows', () => {
    for (const real of WINDOWS) {
      const w = resolveEffectiveContextWindow({ contextLength: real })
      expect(w).toBeLessThanOrEqual(Math.min(real, CONTEXT_WINDOW_CAP))
      for (const overhead of [0, 7_100, 10_000]) {
        const budget = historyBudgetTokens(w, overhead)
        expect(budget).toBeLessThanOrEqual(ceilingOf(w))
        expect(budget).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('the budget subtracts the reserve — it is not the whole window', () => {
    // Without this, a 32k model is handed a history sized to its entire window and the
    // provider rejects the request.
    for (const real of WINDOWS) {
      const w = resolveEffectiveContextWindow({ contextLength: real })
      expect(historyBudgetTokens(w, 0)).toBeLessThan(w)
      expect(w - historyBudgetTokens(w, 0)).toBeGreaterThanOrEqual(scaledReserveTokens(w))
    }
  })

  test('the fixed prompt+tools floor comes out of the budget, not out of thin air', () => {
    const w = resolveEffectiveContextWindow({ contextLength: 32_000 })
    expect(historyBudgetTokens(w, 10_000)).toBe(historyBudgetTokens(w, 0) - 10_000)
    // Never negative: a floor larger than the ceiling yields no history, not a negative budget.
    expect(historyBudgetTokens(w, 10_000_000)).toBe(0)
  })

  test('the protected tail scales with the budget the model actually lives in', () => {
    // Callers pass the EFFECTIVE window, so MODEL_TRIM_KEEP_RECENT_CAP no longer binds:
    // a 1M model gets 0.15 × 256k = 38400, not the 65536 the raw window produced.
    expect(
      resolveKeepRecentTokens(resolveEffectiveContextWindow({ contextLength: 1_000_000 })),
    ).toBe(38_400)
    expect(resolveKeepRecentTokens(resolveEffectiveContextWindow({ contextLength: 32_000 }))).toBe(
      MODEL_TRIM_KEEP_RECENT_TOKENS,
    )
  })
})
