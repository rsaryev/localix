/**
 * Cost-formula parity guard: pi-ai's `calculateCost` vs the app's
 * `calcUsageWithCost` (apps/api/.../run-accounting.ts).
 *
 * Both sides price the same usage independently — the app deliberately
 * recomputes with its own catalog and downgrades pi's estimate (pi's numbers
 * would otherwise be misread as provider-reported 'actual'). The formulas agree
 * TODAY: tier selection by total input, cache reads at the cacheRead rate, 5m
 * cache writes at the catalog cacheWrite rate, and the Anthropic 1h retention
 * hardcoded at input × 2 — on BOTH sides, as two separate constants. This test
 * prices shared fixtures through pi's function and through a labeled mirror of
 * the app formula; if either side ever moves (a pi re-vendor changing the 1h
 * multiplier, or a run-accounting edit), the parity breaks loudly here instead
 * of as silently wrong spend numbers.
 */
import { describe, expect, test } from 'bun:test'
import { calculateCost, type Model, type Usage } from '@earendil-works/pi-ai'

interface FixtureRates {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  tiers?: Array<{
    inputTokensAbove: number
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
  }>
}

interface FixtureUsage {
  /** Non-cached input tokens (pi's `usage.input` bucket). */
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  cacheWrite1h?: number
}

/**
 * Labeled MIRROR of calcUsageWithCost's pricing arithmetic
 * (apps/api/src/features/chat/runtime/run-accounting.ts:50-68), expressed over
 * pi's buckets (non-cached input; the app subtracts caches from its
 * total-context inputTokens to get the same number). Kept in this test on
 * purpose: apps/api cannot be imported from here, and the whole point is an
 * independent statement of the agreed semantics.
 */
function appFormula(rates: FixtureRates, usage: FixtureUsage): number {
  const totalInput = usage.input + usage.cacheRead + usage.cacheWrite
  let tierRates: Omit<FixtureRates, 'tiers'> = rates
  let matched = -1
  for (const tier of rates.tiers ?? []) {
    if (totalInput > tier.inputTokensAbove && tier.inputTokensAbove > matched) {
      tierRates = tier
      matched = tier.inputTokensAbove
    }
  }
  const cacheWrite1h = Math.min(usage.cacheWrite, usage.cacheWrite1h ?? 0)
  const cacheWrite5m = usage.cacheWrite - cacheWrite1h
  return (
    (usage.input / 1_000_000) * tierRates.input +
    (usage.output / 1_000_000) * tierRates.output +
    (usage.cacheRead / 1_000_000) * tierRates.cacheRead +
    (cacheWrite5m / 1_000_000) * tierRates.cacheWrite +
    (cacheWrite1h / 1_000_000) * tierRates.input * 2
  )
}

function piModel(rates: FixtureRates): Model<'anthropic-messages'> {
  return {
    id: 'fixture',
    provider: 'anthropic',
    api: 'anthropic-messages',
    name: 'Fixture',
    reasoning: false,
    input: ['text'],
    contextWindow: 200_000,
    maxTokens: 8192,
    cost: rates,
  } as unknown as Model<'anthropic-messages'>
}

function piUsage(usage: FixtureUsage): Usage {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: usage.cacheWrite1h } : {}),
    totalTokens: usage.input + usage.output + usage.cacheRead + usage.cacheWrite,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  } as unknown as Usage
}

const BASE_RATES: FixtureRates = { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }

describe('cost parity: pi calculateCost ≡ run-accounting formula', () => {
  const FIXTURES: Array<[string, FixtureRates, FixtureUsage]> = [
    [
      'plain input/output',
      BASE_RATES,
      { input: 10_000, output: 2_000, cacheRead: 0, cacheWrite: 0 },
    ],
    [
      'cache read + 5m write',
      BASE_RATES,
      { input: 5_000, output: 1_000, cacheRead: 80_000, cacheWrite: 12_000 },
    ],
    [
      '1h cache write at input × 2 (the twin hardcodes)',
      BASE_RATES,
      { input: 5_000, output: 1_000, cacheRead: 40_000, cacheWrite: 20_000, cacheWrite1h: 15_000 },
    ],
    [
      'tier pricing selected by TOTAL input (incl. caches)',
      {
        ...BASE_RATES,
        tiers: [
          { inputTokensAbove: 200_000, input: 6, output: 22.5, cacheRead: 0.6, cacheWrite: 7.5 },
        ],
      },
      { input: 50_000, output: 3_000, cacheRead: 180_000, cacheWrite: 10_000, cacheWrite1h: 4_000 },
    ],
  ]

  for (const [name, rates, usage] of FIXTURES) {
    test(name, () => {
      const pi = calculateCost(piModel(rates), piUsage(usage))
      expect(pi.total).toBeCloseTo(appFormula(rates, usage), 10)
    })
  }
})
