import { describe, expect, test } from 'bun:test'

import {
  nextRefreshDelay,
  RECENT_ACTIVITY_MS,
  REFRESH_COLD_MS,
  REFRESH_LIVE_MS,
  REFRESH_RECENT_MS,
  REFRESH_WARM_MS,
  WARM_ACTIVITY_MS,
} from './refreshPolicy'

const NOW = Date.parse('2026-08-03T12:00:00.000Z')

const base = { now: NOW, visible: true, liveDelegations: 0 }

describe('roster refresh cadence', () => {
  test('a hidden view stops entirely rather than slowing down', () => {
    // A long delay would still wake a timer for a tab that may never be shown again.
    expect(nextRefreshDelay({ ...base, visible: false }).delayMs).toBeNull()
  })

  test('a running delegation is the strongest signal and wins over everything else', () => {
    const decision = nextRefreshDelay({
      ...base,
      liveDelegations: 2,
      lastActivityAt: NOW - WARM_ACTIVITY_MS * 10,
    })
    expect(decision.delayMs).toBe(REFRESH_LIVE_MS)
    expect(decision.reason).toContain('2 running')
  })

  test('the cadence relaxes as activity ages', () => {
    expect(nextRefreshDelay({ ...base, lastActivityAt: NOW - 1_000 }).delayMs).toBe(
      REFRESH_RECENT_MS,
    )
    expect(
      nextRefreshDelay({ ...base, lastActivityAt: NOW - RECENT_ACTIVITY_MS - 1 }).delayMs,
    ).toBe(REFRESH_WARM_MS)
    expect(nextRefreshDelay({ ...base, lastActivityAt: NOW - WARM_ACTIVITY_MS - 1 }).delayMs).toBe(
      REFRESH_COLD_MS,
    )
  })

  test('an unknown last-activity is cold, not urgent', () => {
    // It means nothing has been read yet; guessing "busy" makes an empty machine poll hardest.
    expect(nextRefreshDelay(base).delayMs).toBe(REFRESH_COLD_MS)
  })

  test('a future timestamp does not produce a negative or frantic delay', () => {
    // Provider clocks are not our clock — a transcript restored from a backup can be "newer".
    const decision = nextRefreshDelay({ ...base, lastActivityAt: NOW + 60_000 })
    expect(decision.delayMs).toBe(REFRESH_RECENT_MS)
  })

  test('pushed history changes leave only a cold backstop', () => {
    // The watch says when history moves; a 20 s tick re-enumerating every root learned nothing more.
    const decision = nextRefreshDelay({
      ...base,
      lastActivityAt: NOW - 1_000,
      historyPushed: true,
    })
    expect(decision.delayMs).toBe(REFRESH_COLD_MS)
    // A running delegation's state comes from its screen, which no watch can push.
    expect(nextRefreshDelay({ ...base, liveDelegations: 1, historyPushed: true }).delayMs).toBe(
      REFRESH_LIVE_MS,
    )
  })

  test('the same input always yields the same decision', () => {
    const input = { ...base, lastActivityAt: NOW - 30_000 }
    expect(nextRefreshDelay(input)).toEqual(nextRefreshDelay(input))
  })
})
