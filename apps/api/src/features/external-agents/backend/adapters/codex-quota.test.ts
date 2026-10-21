import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { codexAdapter } from './codex'
import { formatQuota, quotaIsCurrent } from '../../shared/contracts'
import type { AdapterEnv } from './types'

/**
 * Codex records the account's quota window on the SAME `token_count` event as the token counters —
 * `payload.rate_limits.primary`, a sibling of `payload.info`, not a field inside it. Nearly every
 * rollout carries it, and reading it costs nothing the summary walk was not already paying. The shape below mirrors a real rollout, including the fields we ignore, so
 * a future change to the ones we do read fails here rather than in the workspace.
 */
function tokenCount(at: string, usedPercent: number, resetsAtSeconds: number): string {
  return JSON.stringify({
    type: 'event_msg',
    timestamp: at,
    payload: {
      type: 'token_count',
      info: {
        total_token_usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
        model_context_window: 400_000,
      },
      rate_limits: {
        limit_id: 'codex',
        limit_name: null,
        primary: {
          used_percent: usedPercent,
          window_minutes: 10_080,
          resets_at: resetsAtSeconds,
        },
        secondary: null,
        credits: { has_credits: false, unlimited: false, balance: '0' },
        plan_type: 'plus',
        rate_limit_reached_type: null,
      },
    },
  })
}

async function rollout(lines: string[]): Promise<AdapterEnv> {
  const home = await mkdtemp(join(tmpdir(), 'codex-quota-'))
  const dir = join(home, '.codex', 'sessions', '2026', '08', '03')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'rollout-2026-08-03T10-00-00-00000000-0000-7000-8000-000000000001.jsonl'),
    [
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-08-03T10:00:00.000Z',
        payload: { id: '00000000-0000-7000-8000-000000000001', cwd: '/work/app' },
      }),
      ...lines,
    ].join('\n'),
    'utf8',
  )
  return { env: {}, homeDir: home }
}

describe("a session carries the account's quota window as its provider wrote it", () => {
  test('the LAST reading in a rollout wins, and seconds become milliseconds', async () => {
    // A rollout records the window repeatedly; only the final state describes where the account
    // stands. The two readings differ in both fields so neither can pass by accident.
    const env = await rollout([
      tokenCount('2026-08-03T10:05:00.000Z', 8, 1_786_100_000),
      tokenCount('2026-08-03T11:30:00.000Z', 41.5, 1_786_200_000),
    ])
    const refs = await codexAdapter.listSources(env)
    const [summary] = await codexAdapter.readSummaries(refs, env)

    expect(summary?.quotas).toEqual([
      {
        usedPercent: 41.5,
        windowMinutes: 10_080,
        // Codex writes unix SECONDS; every timestamp we hold is ms, and a 1000x error here would
        // read as a window that reset in 1970.
        resetsAt: 1_786_200_000_000,
        planType: 'plus',
        observedAt: Date.parse('2026-08-03T11:30:00.000Z'),
      },
    ])
  })

  test('BOTH windows are read, because `primary` does not name a fixed one', async () => {
    /**
     * Shaped like a real rollout that carries two. `primary` there is a 5-HOUR window (e.g. 40%)
     * and the weekly sits in `secondary` (e.g. 10%), the reverse of the usual readings, where the
     * weekly IS primary and there is no secondary. Reading only `primary` would report a 5-hour
     * percentage on that day and a weekly one on every other, under one label, as though they
     * measured the same thing.
     */
    const home = await mkdtemp(join(tmpdir(), 'codex-quota-'))
    const dir = join(home, '.codex', 'sessions', '2026', '08', '01')
    await mkdir(dir, { recursive: true })
    await writeFile(
      join(dir, 'rollout-2026-08-01T10-00-00-00000000-0000-7000-8000-000000000004.jsonl'),
      [
        JSON.stringify({
          type: 'session_meta',
          timestamp: '2026-08-01T10:00:00.000Z',
          payload: { id: '00000000-0000-7000-8000-000000000004', cwd: '/work/app' },
        }),
        JSON.stringify({
          type: 'event_msg',
          timestamp: '2026-08-01T10:05:00.000Z',
          payload: {
            type: 'token_count',
            info: { total_token_usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } },
            rate_limits: {
              primary: { used_percent: 40, window_minutes: 300, resets_at: 1_800_000_000 },
              secondary: { used_percent: 10, window_minutes: 10_080, resets_at: 1_800_600_000 },
              plan_type: 'plus',
            },
          },
        }),
      ].join('\n'),
      'utf8',
    )
    const env: AdapterEnv = { env: {}, homeDir: home }
    const refs = await codexAdapter.listSources(env)
    const [summary] = await codexAdapter.readSummaries(refs, env)

    expect(summary?.quotas?.map((q) => [q.windowMinutes, q.usedPercent])).toEqual([
      [300, 40],
      [10_080, 10],
    ])
  })

  test('a rollout without rate limits reports no reading rather than a zero', async () => {
    const env = await rollout([
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-08-03T10:05:00.000Z',
        payload: {
          type: 'token_count',
          info: { total_token_usage: { input_tokens: 5, output_tokens: 1, total_tokens: 6 } },
        },
      }),
    ])
    const refs = await codexAdapter.listSources(env)
    const [summary] = await codexAdapter.readSummaries(refs, env)

    // 0% used would be a confident claim about an account nobody measured.
    expect(summary?.quotas).toBeUndefined()
    expect(summary?.usage?.totalTokens).toBe(6)
  })
})

describe('a reading describes a window that ends', () => {
  const quota = {
    usedPercent: 87,
    windowMinutes: 10_080,
    resetsAt: Date.parse('2026-08-08T08:00:00.000Z'),
    planType: 'plus',
    observedAt: Date.parse('2026-08-03T16:00:00.000Z'),
  }

  test('past its reset it is not stale data, it is data about a window that is gone', async () => {
    const during = Date.parse('2026-08-05T00:00:00.000Z')
    const after = Date.parse('2026-08-09T00:00:00.000Z')

    expect(quotaIsCurrent(quota, during)).toBe(true)
    expect(quotaIsCurrent(quota, after)).toBe(false)
    // The percentage must not appear once the window it measured has rolled over.
    expect(formatQuota(quota, after)).not.toContain('87')
    expect(formatQuota(quota, after)).toContain('ended')
  })

  test('a current reading says how much, of what, and how long until it clears', async () => {
    const label = formatQuota(quota, Date.parse('2026-08-06T08:00:00.000Z'))

    expect(label).toContain('87%')
    expect(label).toContain('7d window')
    expect(label).toContain('resets in 2d')
  })
})
