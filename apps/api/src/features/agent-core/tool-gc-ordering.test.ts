import { describe, expect, test } from 'bun:test'

import {
  resolveToolGc,
  TOOL_GC_MIN_TOTAL_CALLS,
  type ToolGcSurfaced,
  type ToolGcUsage,
} from './tool-gc'

const NOW = '2026-08-01T00:00:00.000Z'
const daysAgo = (days: number) => new Date(Date.parse(NOW) - days * 86_400_000).toISOString()

const surfaced = (name: string): ToolGcSurfaced => ({ name, source: 'builtin', originId: '' })
const used = (name: string, over: Partial<ToolGcUsage> = {}): ToolGcUsage => ({
  name,
  calls: 0,
  errors: 0,
  firstSeenAt: daysAgo(60),
  lastUsedAt: null,
  ...over,
})
/** Enough recorded calls to clear the evidence gate, so the rules under test can run at all. */
const ballast = () => used('bash', { calls: TOOL_GC_MIN_TOTAL_CALLS, lastUsedAt: daysAgo(1) })

/**
 * The suggestion order's tie-breakers, each isolated so only ITS tier can explain the result.
 *
 * `tool-gc.test.ts` already covers the primary key (verdict strength) and the final one (name), but
 * its cold fixtures are `aaa_cold` with 2 calls and `zzz_cold` with 9 — sorting by name alone
 * produces the identical list, so deleting the call-count tier, or the last-used tier, left it
 * green. Both tiers are load-bearing: within one verdict they decide which tool the user is offered
 * first, and the brief specifies them. The names below run OPPOSITE to the metric on purpose, which
 * is the only way an assertion can tell the tiers apart.
 *
 * Kept in its own file rather than appended to `tool-gc.test.ts`, which currently carries another
 * agent's uncommitted edit.
 */
describe('tool GC suggestion order — the tie-breakers', () => {
  test('within one verdict, the least-used comes first even when the name says otherwise', () => {
    const { suggestions } = resolveToolGc({
      surfaced: [surfaced('aaa_busy'), surfaced('zzz_quiet')],
      usage: [
        used('aaa_busy', { calls: 30, lastUsedAt: daysAgo(40) }),
        used('zzz_quiet', { calls: 2, lastUsedAt: daysAgo(40) }),
        ballast(),
      ],
      now: NOW,
    })

    // Least used first: it is the safest one to switch off, so it is the one to offer first.
    expect(suggestions.map((s) => s.name)).toEqual(['zzz_quiet', 'aaa_busy'])
  })

  test('equally used, the one idle longest comes first even when the name says otherwise', () => {
    const { suggestions } = resolveToolGc({
      surfaced: [surfaced('aaa_recent'), surfaced('zzz_ancient')],
      usage: [
        used('aaa_recent', { calls: 5, lastUsedAt: daysAgo(31) }),
        used('zzz_ancient', { calls: 5, lastUsedAt: daysAgo(200) }),
        ballast(),
      ],
      now: NOW,
    })

    expect(suggestions.map((s) => s.name)).toEqual(['zzz_ancient', 'aaa_recent'])
  })

  test('the verdict outranks the tie-breakers, which only apply within one', () => {
    // The pairing has to make the two tiers DISAGREE, or the assertion cannot tell them apart: a
    // never-used tool always has zero calls, so "never before cold" is equally explained by the
    // call-count tier. A cold tool with MANY calls against an always-failing one with few is the
    // case where verdict strength and least-used point opposite ways.
    const { suggestions } = resolveToolGc({
      surfaced: [surfaced('cold_but_busy'), surfaced('broken')],
      usage: [
        used('cold_but_busy', { calls: 40, lastUsedAt: daysAgo(60) }),
        used('broken', { calls: 6, errors: 6, lastUsedAt: daysAgo(1) }),
        ballast(),
      ],
      now: NOW,
    })

    expect(suggestions.map((s) => s.name)).toEqual(['cold_but_busy', 'broken'])
  })
})
