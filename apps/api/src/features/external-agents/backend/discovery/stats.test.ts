import { describe, expect, test } from 'bun:test'

import { computeStats, DEFAULT_STATS_DAYS, STATS_PROJECT_LIMIT } from './stats'
import { STATS_SESSION_LIMIT } from './stats-rankings'
import type { SessionSummary, SessionTokenUsage, TokenUsage } from '../../shared/contracts'

const NOW = Date.parse('2026-08-03T12:00:00.000Z')
const DAY = 86_400_000

function session(partial: Partial<SessionSummary> & { nativeSessionId: string }): SessionSummary {
  const { nativeSessionId, ...overrides } = partial
  const provider = overrides.provider ?? 'claude-code'
  return {
    key: `${provider}:${nativeSessionId}`,
    provider,
    nativeSessionId,
    title: nativeSessionId,
    updatedAt: NOW - DAY,
    sourcePath: `/tmp/${nativeSessionId}.jsonl`,
    ...overrides,
  }
}

function counters(partial: Partial<TokenUsage>): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    requests: 0,
    ...partial,
  }
}

function measuredUsage(): SessionTokenUsage {
  const recent = counters({
    inputTokens: 60,
    cachedInputTokens: 40,
    outputTokens: 10,
    totalTokens: 110,
    requests: 1,
  })
  const old = counters({ inputTokens: 20, outputTokens: 5, totalTokens: 25, requests: 1 })
  return {
    ...counters({
      inputTokens: 80,
      cachedInputTokens: 40,
      outputTokens: 15,
      totalTokens: 135,
      requests: 2,
    }),
    byModel: [{ model: 'gpt-5.6-sol', ...counters({ totalTokens: 135, requests: 2 }) }],
    byDay: [
      {
        day: '2026-07-01',
        ...old,
        byModel: [{ model: 'gpt-5.6-sol', ...old }],
      },
      {
        day: '2026-08-02',
        ...recent,
        byModel: [{ model: 'gpt-5.6-sol', ...recent }],
      },
    ],
  }
}

describe('the heaviest sessions are their own axis', () => {
  /**
   * Every other axis AGGREGATES, which hides how concentrated the spend is: a handful of sessions
   * can account for most of the tokens while `byProject` folds them into one bar with everything
   * else. "Which runs cost the most" is a question no other axis can answer.
   */
  const withTokens = (id: string, total: number, title?: string) =>
    session({
      nativeSessionId: id,
      ...(title ? { title } : {}),
      usage: {
        inputTokens: total,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        reasoningTokens: 0,
        totalTokens: total,
        requests: 1,
        byModel: [],
        byDay: [],
      },
    })

  test('ranked by measured tokens, carrying the key and a readable label', () => {
    const stats = computeStats(
      [
        withTokens('small', 10),
        withTokens('huge', 3_000, 'Optimise the animation'),
        withTokens('mid', 500),
      ],
      {},
      NOW,
    )
    expect(stats.topSessions.map((b) => b.key)).toEqual([
      'claude-code:huge',
      'claude-code:mid',
      'claude-code:small',
    ])
    // The key addresses the same session every other surface does; the label is what a reader knows.
    expect(stats.topSessions[0]?.label).toBe('Optimise the animation')
    expect(stats.topSessions[0]?.usage?.totalTokens).toBe(3_000)
  })

  test('a session whose provider measured nothing is unranked, not ranked as free', () => {
    // Ranking it as a zero would sort it to the bottom and read as "this run cost nothing", which is
    // a measurement nobody took — the same rule the token tiles follow.
    const stats = computeStats(
      [withTokens('measured', 100), session({ nativeSessionId: 'silent' })],
      {},
      NOW,
    )
    expect(stats.topSessions.map((b) => b.key)).toEqual(['claude-code:measured'])
  })

  test('the axis is bounded, and the bound is the one the screen names', () => {
    const many = Array.from({ length: 20 }, (_, i) => withTokens(`s${i}`, (20 - i) * 100))
    const stats = computeStats(many, {}, NOW)
    expect(stats.topSessions).toHaveLength(STATS_SESSION_LIMIT)
    expect(stats.topSessions[0]?.key).toBe('claude-code:s0')
  })
})

describe('external agent statistics', () => {
  test('folds sessions by provider and by project', () => {
    const stats = computeStats(
      [
        session({ nativeSessionId: 'a', cwd: '/work/app', messageCount: 10 }),
        session({ nativeSessionId: 'b', cwd: '/work/app', messageCount: 5 }),
        session({ nativeSessionId: 'c', provider: 'codex', cwd: '/work/api', messageCount: 3 }),
      ],
      {},
      NOW,
    )

    expect(stats.sessions).toBe(3)
    expect(stats.messages).toBe(18)
    expect(stats.byProvider.map((b) => [b.key, b.sessions])).toEqual([
      ['claude-code', 2],
      ['codex', 1],
    ])
    expect(stats.byProject[0]).toMatchObject({ key: '/work/app', sessions: 2, messages: 15 })
  })

  test('the trend carries every day in the window, including the empty ones', () => {
    // A trend drawn only from days that had activity compresses a quiet week into a dense line.
    const stats = computeStats([session({ nativeSessionId: 'a' })], { days: 7 }, NOW)
    expect(stats.byDay).toHaveLength(7)
    expect(stats.byDay.filter((b) => b.sessions > 0)).toHaveLength(1)
    expect(stats.byDay.at(-1)?.key).toBe('2026-08-03')
  })

  test('sub-agent transcripts are excluded unless asked for', () => {
    // They outnumber their parents several to one, so counting them reports a session volume
    // nobody recognises as their own.
    const rows = [
      session({ nativeSessionId: 'parent' }),
      session({ nativeSessionId: 'child', parentNativeSessionId: 'parent' }),
    ]
    expect(computeStats(rows, {}, NOW).sessions).toBe(1)
    expect(computeStats(rows, { includeChildren: true }, NOW).sessions).toBe(2)
  })

  test('a provider filter narrows every axis except the one it is chosen from', () => {
    // The agent distribution is the CONTROL the filter is driven from. Folding it through the
    // filter collapsed it to a single full-width bar the instant an agent was picked, leaving
    // nothing to pick next and no comparison to read.
    const stats = computeStats(
      [
        session({ nativeSessionId: 'a' }),
        session({ nativeSessionId: 'b', provider: 'codex', cwd: '/work/api' }),
      ],
      { providers: ['codex'] },
      NOW,
    )
    expect(stats.sessions).toBe(1)
    expect(stats.byProject[0]?.key).toBe('/work/api')
    expect(stats.byProvider.map((b) => b.key).sort()).toEqual(['claude-code', 'codex'])
  })

  test('only sessions that record both ends contribute a duration', () => {
    const stats = computeStats(
      [
        session({ nativeSessionId: 'a', startedAt: NOW - 2 * DAY, updatedAt: NOW - DAY }),
        session({ nativeSessionId: 'b' }),
      ],
      {},
      NOW,
    )
    expect(stats.medianDurationMs).toBe(DAY)
  })

  test('a message count nobody measured is absent, not zero', () => {
    // No adapter fills `messageCount` today (a summary is a bounded head+tail read). Reporting 0
    // would be a measurement nobody took.
    const stats = computeStats([session({ nativeSessionId: 'a' })], {}, NOW)
    expect(stats.messages).toBeUndefined()
    expect(stats.byProvider[0]?.messages).toBeUndefined()
  })

  test('reports provider-measured usage by day, model, agent, and project', () => {
    const stats = computeStats(
      [
        session({
          nativeSessionId: 'measured',
          cwd: '/work/app',
          usage: measuredUsage(),
        }),
      ],
      { days: 7 },
      NOW,
    )

    // The July request belongs outside this view even though the session itself was updated in it.
    expect(stats.usage).toMatchObject({
      inputTokens: 60,
      cachedInputTokens: 40,
      outputTokens: 10,
      totalTokens: 110,
      requests: 1,
    })
    expect(stats.usageSessions).toBe(1)
    expect(stats.byModel[0]).toMatchObject({
      key: 'gpt-5.6-sol',
      sessions: 1,
      usage: { totalTokens: 110 },
    })
    expect(stats.byProvider[0]?.usage?.totalTokens).toBe(110)
    expect(stats.byProject[0]?.usage?.totalTokens).toBe(110)
    expect(stats.byDay.reduce((sum, day) => sum + (day.usage?.totalTokens ?? 0), 0)).toBe(110)
  })

  test('an empty history reports nothing rather than zeroes with a shape', () => {
    const stats = computeStats([], {}, NOW)
    expect(stats.sessions).toBe(0)
    expect(stats.firstAt).toBeUndefined()
    expect(stats.medianDurationMs).toBeUndefined()
    expect(stats.byDay).toHaveLength(DEFAULT_STATS_DAYS)
  })
})

describe('provider counts match what the roster shows', () => {
  test('a provider total counts top-level sessions, not every file it owns', () => {
    // Found by auditing against disk: Claude Code has 123 top-level sessions and 1581 sub-agent
    // transcripts beneath them, so a total over every file said "1706" beside a list showing 123 —
    // two different quantities wearing one name.
    const rows = [
      session({ nativeSessionId: 'parent' }),
      session({ nativeSessionId: 'kid-1', parentNativeSessionId: 'parent' }),
      session({ nativeSessionId: 'kid-2', parentNativeSessionId: 'parent' }),
    ]
    expect(computeStats(rows, {}, NOW).sessions).toBe(1)
    expect(computeStats(rows, {}, NOW).byProvider[0]?.sessions).toBe(1)
  })
})

describe('the window scopes every figure, not only the trend', () => {
  test('a distribution counts the window rather than all of history', () => {
    // Found by probing a real install: on the 7d view the tile counted the window while the bars
    // directly beside it summed all of history, because only the trend and one tile obeyed the
    // range.
    const rows = [
      session({ nativeSessionId: 'recent', cwd: '/work/app', updatedAt: NOW - DAY }),
      session({ nativeSessionId: 'old', cwd: '/work/old', updatedAt: NOW - 200 * DAY }),
    ]
    const stats = computeStats(rows, { days: 7 }, NOW)

    expect(stats.sessions).toBe(1)
    expect(stats.byProject.map((b) => b.key)).toEqual(['/work/app'])
    // The figures a reader can add up now agree with the one they are printed beside.
    expect(stats.byProvider.reduce((total, b) => total + b.sessions, 0)).toBe(stats.sessions)
  })

  test('the history span stays all-time, so a quiet window still says how far back to look', () => {
    const rows = [
      session({ nativeSessionId: 'recent', updatedAt: NOW - DAY }),
      session({ nativeSessionId: 'old', updatedAt: NOW - 200 * DAY }),
    ]
    const stats = computeStats(rows, { days: 7 }, NOW)
    expect(stats.sessions).toBe(1)
    expect(stats.firstAt).toBe(NOW - 200 * DAY)
    expect(stats.lastAt).toBe(NOW - DAY)
  })

  test('an empty window is distinguishable from an empty machine', () => {
    // Both report zero sessions; only one of them can be fixed by widening the range, so the two
    // have to be tellable apart from the result alone.
    const quiet = computeStats(
      [session({ nativeSessionId: 'old', updatedAt: NOW - 200 * DAY })],
      {
        days: 7,
      },
      NOW,
    )
    expect(quiet.sessions).toBe(0)
    expect(quiet.firstAt).toBe(NOW - 200 * DAY)
    expect(computeStats([], { days: 7 }, NOW).firstAt).toBeUndefined()
  })

  test('projects counts every distinct directory, not the twelve that get listed', () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      session({ nativeSessionId: `s${i}`, cwd: `/work/p${i}` }),
    )
    const stats = computeStats(rows, {}, NOW)
    expect(stats.byProject).toHaveLength(STATS_PROJECT_LIMIT)
    expect(stats.projects).toBe(20)
  })
})

describe('trend bucket size', () => {
  test('a year is weeks, a month is days', () => {
    // 365 bars is not a chart: at any real panel width each is under a pixel.
    expect(computeStats([], { days: 365 }, NOW).byDay).toHaveLength(53)
    expect(computeStats([], { days: 365 }, NOW).bucketDays).toBe(7)
    expect(computeStats([], { days: 30 }, NOW).byDay).toHaveLength(30)
    expect(computeStats([], { days: 30 }, NOW).bucketDays).toBe(1)
  })

  test('a weekly bucket is named by the day it starts', () => {
    // So a bar reads as "the week starting …" rather than as a day that absorbed six others.
    const stats = computeStats([], { days: 365 }, NOW)
    const first = Date.parse(`${stats.byDay[0]!.key}T00:00:00.000Z`)
    const second = Date.parse(`${stats.byDay[1]!.key}T00:00:00.000Z`)
    expect(second - first).toBe(7 * DAY)
  })

  test('sessions land in the bucket their activity falls in', () => {
    const stats = computeStats(
      [
        session({ nativeSessionId: 'now', updatedAt: NOW - DAY }),
        session({ nativeSessionId: 'old', updatedAt: NOW - 200 * DAY }),
      ],
      { days: 365 },
      NOW,
    )
    const busy = stats.byDay.filter((b) => b.sessions > 0)
    expect(busy).toHaveLength(2)
    // The recent one is in the last bucket; the old one is far from it.
    expect(stats.byDay.at(-1)?.sessions).toBe(1)
  })
})

describe('agents the window excluded entirely', () => {
  /**
   * The figure both surfaces need and neither can derive: an agent with nothing in range leaves no
   * bar and no row, so its absence looks identical to never having existed. With the 30-day
   * default, agents used less often land here, along with every session the window hides.
   */
  const DAY = 86_400_000
  const now = Date.parse('2026-08-04T00:00:00.000Z')

  function row(provider: string, daysAgo: number, id = `${provider}-${daysAgo}`): SessionSummary {
    return {
      key: `${provider}:${id}`,
      provider,
      nativeSessionId: id,
      title: id,
      updatedAt: now - daysAgo * DAY,
      sourcePath: `/tmp/${id}`,
    }
  }

  test('names a provider whose newest session predates the window, with its all-time count', () => {
    const stats = computeStats(
      [row('codex', 1), row('hermes', 60), row('hermes', 70), row('hermes', 80)],
      { days: 30 },
      now,
    )

    expect(stats.outsideRange).toEqual([{ key: 'hermes', sessions: 3, updatedAt: now - 60 * DAY }])
    // The count is ALL-TIME for that provider — the point is what the window left out.
    expect(stats.byProvider.map((b) => b.key)).toEqual(['codex'])
  })

  test('says nothing about a provider with even one session in range', () => {
    const stats = computeStats(
      [row('codex', 1), row('hermes', 2), row('hermes', 90)],
      { days: 30 },
      now,
    )

    expect(stats.outsideRange).toEqual([])
  })

  test('respects the provider filter, unlike the agent axis', () => {
    // Filtered to hermes: codex having older history is not the question asked. The agent axis still
    // lists every agent, because it is the control you drill WITH.
    const rows = [row('codex', 90), row('hermes', 60), row('opencode', 2)]
    const stats = computeStats(rows, { days: 30, providers: ['hermes'] }, now)

    expect(stats.outsideRange.map((b) => b.key)).toEqual(['hermes'])
  })

  test('orders by how much is hidden, so the biggest omission reads first', () => {
    const stats = computeStats(
      [
        row('codex', 1),
        row('hermes', 60),
        row('opencode', 61),
        row('opencode', 62),
        row('opencode', 63),
      ],
      { days: 30 },
      now,
    )

    expect(stats.outsideRange.map((b) => `${b.key}:${b.sessions}`)).toEqual([
      'opencode:3',
      'hermes:1',
    ])
  })
})

describe('usageSessions is the honesty figure, so it counts only what was measured', () => {
  /**
   * The screen reads "Usage is provider-reported for N of M sessions in range", and several decisions
   * rest on that N being smaller than M: GitHub Copilot records no input tokens and reports no usage at
   * all, which is only defensible because this figure says so. A mutation sweep found nothing testing
   * it — replacing it with the row count left every test green, and the footer would have claimed every
   * session was measured.
   */
  const DAY = 86_400_000
  const now = Date.parse('2026-08-04T00:00:00.000Z')

  function plain(id: string): SessionSummary {
    return {
      key: `codex:${id}`,
      provider: 'codex',
      nativeSessionId: id,
      title: id,
      updatedAt: now - DAY,
      sourcePath: `/tmp/${id}`,
    }
  }

  /**
   * `byDay` is what carries usage into the window — `usageInWindow` sums only days at or after the
   * window's first, which is the rule that keeps a long session's whole lifetime from being charged to
   * the day its transcript was last touched. A session with no in-window day is therefore counted in
   * `sessions` and not in `usageSessions`, which the third test pins.
   */
  function measured(id: string, day = '2026-08-03'): SessionSummary {
    const usage: TokenUsage = {
      inputTokens: 10,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 5,
      reasoningTokens: 0,
      totalTokens: 15,
      requests: 1,
    }
    const byModel = [{ model: 'm', ...usage }]
    return {
      ...plain(id),
      usage: { ...usage, byModel, byDay: [{ day, ...usage, byModel }] },
    }
  }

  test('sessions without provider usage are counted in M and not in N', () => {
    const stats = computeStats([measured('a'), plain('b'), plain('c')], { days: 30 }, now)

    expect(stats.sessions).toBe(3)
    expect(stats.usageSessions).toBe(1)
  })

  test('usage recorded only OUTSIDE the window counts in M and not in N', () => {
    // The row is in range — `updatedAt` is yesterday — while every token it reports belongs to a day
    // the window excludes. Counting it as measured would put a 0-token session in the numerator.
    const stats = computeStats([measured('old', '2026-01-01')], { days: 30 }, now)

    expect(stats.sessions).toBe(1)
    expect(stats.usageSessions).toBe(0)
  })

  test('a range where nothing was measured says zero rather than every session', () => {
    const stats = computeStats([plain('a'), plain('b')], { days: 30 }, now)

    expect(stats.sessions).toBe(2)
    expect(stats.usageSessions).toBe(0)
    // And no usage block at all, so the screen shows dashes instead of zeros.
    expect(stats.usage).toBeUndefined()
  })
})

describe('activeDays says how much of the window is not empty', () => {
  /**
   * The trend draws every bucket in the window, empty ones included, which is right — a gap is
   * information. What it leaves out is the divisor: a reader forming "sessions per day" from the
   * total uses the window's LENGTH. In a history with idle stretches only part of a wide range
   * holds anything, so the same total can be several times denser than the axis suggests. Named
   * after CodexBar's `coveredDayCount`, which carries the figure for the same reason.
   */
  const DAY = 86_400_000
  const now = Date.parse('2026-08-04T12:00:00.000Z')

  function on(daysAgo: number, id = `s${daysAgo}`): SessionSummary {
    return {
      key: `codex:${id}`,
      provider: 'codex',
      nativeSessionId: id,
      title: id,
      updatedAt: now - daysAgo * DAY,
      sourcePath: `/tmp/${id}`,
    }
  }

  test('counts days that hold a session, not days in the range', () => {
    const stats = computeStats([on(0), on(1), on(1, 'b'), on(20)], { days: 30 }, now)

    expect(stats.byDay.length).toBe(30)
    // Three distinct days, one of which holds two sessions.
    expect(stats.activeDays).toBe(3)
    expect(stats.sessions).toBe(4)
  })

  test('a window with nothing in it reports zero rather than its length', () => {
    const stats = computeStats([on(200)], { days: 30 }, now)

    expect(stats.byDay.length).toBe(30)
    expect(stats.activeDays).toBe(0)
  })

  test('a fully busy window reports its whole length', () => {
    const rows = Array.from({ length: 7 }, (_, i) => on(i))
    const stats = computeStats(rows, { days: 7 }, now)

    expect(stats.activeDays).toBe(stats.byDay.length)
  })
})

describe('the model axis is not derived from tokens alone', () => {
  /**
   * It was, so a provider that reports no token usage contributed no models: GitHub Copilot's 34
   * sessions and 5,541 messages left the axis empty and the tile above reading "0 models" — a claim
   * about models rather than about measurement. Its logs record `selectedModel` on 3 of those 34, and
   * the axis now shows those 3 and stays silent about the rest.
   */
  const now = Date.parse('2026-08-05T00:00:00.000Z')

  function row(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
    return {
      key: `github-copilot:${id}`,
      provider: 'github-copilot',
      nativeSessionId: id,
      title: id,
      updatedAt: now - 86_400_000,
      sourcePath: `/tmp/${id}`,
      ...over,
    }
  }

  test('a session with a model and no usage still reaches the axis, with no tokens', () => {
    const stats = computeStats(
      [row('a', { model: 'gpt-5.4' }), row('b', { model: 'gpt-5.4' }), row('c')],
      { days: 30 },
      now,
    )

    expect(stats.byModel.map((b) => [b.key, b.sessions])).toEqual([['gpt-5.4', 2]])
    // Counted as sessions, never as tokens nobody measured.
    expect(stats.byModel[0]?.usage?.totalTokens ?? 0).toBe(0)
    expect(stats.usageSessions).toBe(0)
  })

  test('sessions that record no model leave the axis empty rather than inventing one', () => {
    const stats = computeStats([row('a'), row('b')], { days: 30 }, now)

    expect(stats.byModel).toEqual([])
    expect(stats.sessions).toBe(2)
  })
})

describe('a project drill narrows the statistics, as an agent drill does', () => {
  /**
   * `RosterQuery.cwdPrefix` existed from the start, was validated by the route and implemented in
   * the fold — and nothing ever sent one. `StatsQuery` did not have it at all, so the project axis
   * could not drill the way the agent axis does. Selecting a project now narrows the sessions to
   * that project's and the project count to one.
   */
  const now = Date.parse('2026-08-05T00:00:00.000Z')

  function at(cwd: string | undefined, id: string): SessionSummary {
    return {
      key: `codex:${id}`,
      provider: 'codex',
      nativeSessionId: id,
      title: id,
      updatedAt: now - 86_400_000,
      sourcePath: `/tmp/${id}`,
      ...(cwd ? { cwd } : {}),
    }
  }

  const rows = [
    at('/work/app', 'a'),
    at('/work/app/packages/ui', 'b'),
    at('/work/other', 'c'),
    at(undefined, 'd'),
  ]

  test('it is a PREFIX, so a project selects its own subtree too', () => {
    const stats = computeStats(rows, { days: 30, cwdPrefix: '/work/app' }, now)

    expect(stats.sessions).toBe(2)
    expect(stats.byProject.map((bucket) => bucket.key).sort()).toEqual([
      '/work/app',
      '/work/app/packages/ui',
    ])
  })

  test('sessions with no cwd are outside every project drill', () => {
    const stats = computeStats(rows, { days: 30, cwdPrefix: '/work' }, now)

    expect(stats.sessions).toBe(3)
    expect(stats.byProject.some((bucket) => bucket.key.includes('no working directory'))).toBe(
      false,
    )
  })

  test('it composes with the provider filter rather than replacing it', () => {
    const mixed = [...rows, { ...at('/work/app', 'e'), provider: 'hermes', key: 'hermes:e' }]
    const stats = computeStats(
      mixed,
      { days: 30, cwdPrefix: '/work/app', providers: ['hermes'] },
      now,
    )

    expect(stats.sessions).toBe(1)
    expect(stats.byProvider.map((bucket) => bucket.key)).toContain('hermes')
  })

  test('no prefix leaves every session in', () => {
    expect(computeStats(rows, { days: 30 }, now).sessions).toBe(4)
  })
})

describe('the fan-out axis answers what a session delegated', () => {
  /**
   * In a history that delegates, most sessions are children, and they belong to comparatively few
   * parents — some spawning hundreds. Every other axis answers what a session COST; this one
   * answers what it fanned out to, which is the question an orchestrator has.
   *
   * The counting population is the load-bearing part. Children are hidden by default, so folding
   * over the window's selection would report a fan-out of zero for every parent on the screen.
   */
  const parent = session({ nativeSessionId: 'p1', title: 'the orchestrator' })
  const children = Array.from({ length: 3 }, (_, i) =>
    session({ nativeSessionId: `c${i}`, parentNativeSessionId: 'p1' }),
  )

  test('a parent is ranked by children the selection does not contain', () => {
    // The children are excluded from the fold (they are children), and the count is still 3.
    const stats = computeStats([parent, ...children], { days: 30 }, NOW)

    expect(stats.sessions).toBe(1)
    expect(stats.byParent).toHaveLength(1)
    expect(stats.byParent[0]).toMatchObject({
      key: parent.key,
      label: 'the orchestrator',
      sessions: 3,
    })
  })

  test('a session that delegated nothing is absent, not a zero', () => {
    // A zero would sort to the bottom of a bar chart and read as "this one ran alone", which is a
    // claim; absence is the honest form of no measurement.
    const alone = session({ nativeSessionId: 'solo' })
    const stats = computeStats([parent, alone, ...children], { days: 30 }, NOW)

    expect(stats.byParent.map((bucket) => bucket.key)).toEqual([parent.key])
  })

  test('parentage is matched within a provider, since ids repeat across them', () => {
    const other = session({ provider: 'codex', nativeSessionId: 'p1', title: 'a codex session' })
    const stats = computeStats([parent, other, ...children], { days: 30 }, NOW)

    // Both are called p1; only the claude-code one has the children.
    expect(stats.byParent).toHaveLength(1)
    expect(stats.byParent[0]?.key).toBe(parent.key)
  })

  test('a parent outside the window is not named, because the screen cannot reach it', () => {
    const old = session({ nativeSessionId: 'p1', title: 'old', updatedAt: NOW - 90 * DAY })
    const stats = computeStats([old, ...children], { days: 30 }, NOW)

    expect(stats.byParent).toEqual([])
  })

  test('nothing anywhere records parentage, so the axis is empty rather than invented', () => {
    const stats = computeStats([parent, session({ nativeSessionId: 'x' })], { days: 30 }, NOW)

    expect(stats.byParent).toEqual([])
  })
})
