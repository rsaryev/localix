import { describe, expect, it } from 'bun:test'

import { newestQuotas } from './index-cache'
import type { QuotaReading, SessionSummary } from '../../shared/contracts'

/**
 * A quota is the ACCOUNT's state, not a session's: every session of one agent draws on the same
 * window. So the current reading is the newest one any of them recorded, and an older session's
 * percentage describes a moment that has passed.
 */
function summary(key: string, updatedAt: number, quota?: QuotaReading): SessionSummary {
  return {
    key,
    provider: 'codex',
    nativeSessionId: key,
    title: key,
    updatedAt,
    sourcePath: `/tmp/${key}.jsonl`,
    ...(quota ? { quotas: [quota] } : {}),
  }
}

function reading(usedPercent: number, observedAt: number): QuotaReading {
  return { usedPercent, windowMinutes: 10_080, resetsAt: observedAt + 86_400_000, observedAt }
}

describe('the account window is the newest reading, not the newest session', () => {
  it('takes the latest reading whatever order the summaries arrive in', () => {
    const rows = [
      summary('a', 500, reading(12, 100)),
      summary('b', 100, reading(64, 900)),
      summary('c', 900, reading(31, 400)),
    ]

    // `b` is the OLDEST session by updatedAt and holds the NEWEST reading — a fold keyed on the
    // session's own recency would answer 31% here, for a window that has since moved on.
    expect(newestQuotas(rows).map((q) => q.usedPercent)).toEqual([64])
  })

  it('keeps one reading per WINDOW, shortest first, instead of one per account', () => {
    // Two windows can be open at once and they are different quantities: 45% of five hours is not
    // comparable to 7% of a week. A fold that kept "the newest reading" would answer with whichever
    // window the last session happened to write.
    const fiveHour = { usedPercent: 45, windowMinutes: 300, resetsAt: 9_000, observedAt: 100 }
    const weekly = { usedPercent: 7, windowMinutes: 10_080, resetsAt: 90_000, observedAt: 100 }
    const staleWeekly = { ...weekly, usedPercent: 3, observedAt: 50 }
    const rows = [summary('a', 1, staleWeekly), { ...summary('b', 2), quotas: [fiveHour, weekly] }]

    expect(newestQuotas(rows).map((q) => [q.windowMinutes, q.usedPercent])).toEqual([
      [300, 45],
      [10_080, 7],
    ])
  })

  it('is absent when no session recorded one, rather than defaulting to zero', () => {
    expect(newestQuotas([summary('a', 1), summary('b', 2)])).toEqual([])
  })

  it('ignores sessions without a reading instead of letting them mask one', () => {
    const rows = [summary('a', 900), summary('b', 100, reading(7, 50)), summary('c', 800)]

    expect(newestQuotas(rows).map((q) => q.usedPercent)).toEqual([7])
  })
})
