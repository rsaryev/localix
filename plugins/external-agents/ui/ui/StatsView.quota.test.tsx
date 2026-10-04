import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { StatsView } from './StatsView'
import type { ExternalAgentStats, ProviderStatus } from '../model/types'

/**
 * The account's quota window on the statistics screen.
 *
 * Everything else here is an aggregate over the selected range; a quota is the state of a window the
 * provider owns, on its own clock. That difference is why it renders ABOVE the range bar, and it is
 * what these tests protect: a figure that is not range-scoped must not sit under a sentence
 * promising that everything below it is.
 */
const HOUR = 3_600_000

function status(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    provider: 'codex',
    displayName: 'Codex',
    roots: [{ path: '/home/.codex/sessions', exists: true }],
    sessionCount: 59,
    verified: true,
    ...over,
  }
}

function quota(usedPercent: number, hoursLeft: number) {
  return {
    usedPercent,
    windowMinutes: 10_080,
    resetsAt: Date.now() + hoursLeft * HOUR,
    planType: 'pro',
    observedAt: Date.now() - HOUR,
  }
}

const STATS: ExternalAgentStats = {
  sessions: 12,
  messages: 400,
  usageSessions: 12,
  projects: 3,
  firstAt: Date.now() - 30 * 24 * HOUR,
  lastAt: Date.now(),
  medianDurationMs: 60_000,
  byProvider: [],
  byProject: [],
  byModel: [],
  topSessions: [],
  byParent: [],
  byDay: [],
  activeDays: 1,
  bucketDays: 30,
  outsideRange: [],
}

function render(providers: readonly ProviderStatus[], selectedProvider?: string) {
  return renderToStaticMarkup(
    <StatsView
      stats={STATS}
      loading={false}
      error={null}
      onRetry={() => {}}
      providerNames={new Map([['codex', 'Codex']])}
      providers={providers}
      days="30"
      onChangeDays={() => {}}
      {...(selectedProvider ? { selectedProvider } : {})}
    />,
  )
}

describe('the quota bar states the account window, not the range', () => {
  test('it renders before the sentence that scopes everything below it', () => {
    const html = render([status({ quotas: [quota(8, 107)] })])

    expect(html).toContain('4d 11h')
    // The order IS the claim: under "every figure below covers the last 30 days" this figure would
    // be read as 30-day consumption, which it is not.
    expect(html.indexOf('7d window')).toBeLessThan(html.indexOf('Every figure below'))
  })

  test('a provider that records no quota contributes no row, not a zero', () => {
    const html = render([status({ provider: 'claude-code', displayName: 'Claude Code' })])

    expect(html).not.toContain('window')
    expect(html).not.toContain('0%')
  })

  test('drilling into one agent narrows the bar with the rest of the screen', () => {
    const providers = [
      status({ quotas: [quota(8, 107)] }),
      status({ provider: 'opencode', displayName: 'opencode', quotas: [quota(64, 5)] }),
    ]

    expect(render(providers)).toContain('opencode')
    expect(render(providers, 'codex')).not.toContain('opencode')
  })

  test('near the limit the figure is toned, below it the same words are not', () => {
    // 8% competing for attention with the session counts teaches a reader to stop looking; 87% is
    // the answer to whether another agent can start at all.
    expect(render([status({ quotas: [quota(87, 20)] })])).toContain('text-status-warning')
    expect(render([status({ quotas: [quota(8, 107)] })])).not.toContain('text-status-warning')
  })

  test('every window gets its own row, and the fullest is the one toned', () => {
    // The correction this file exists to hold: `primary` is not a fixed window. Codex puts the
    // 5-hour one there and moves the weekly to `secondary` whenever both are open, so a screen that
    // shows "the quota" shows whichever the provider happened to list first — 7% while the window
    // that actually stops the next agent reads 87%.
    const html = render([
      status({
        quotas: [
          { ...quota(87, 3), windowMinutes: 300 },
          { ...quota(7, 100), windowMinutes: 10_080 },
        ],
      }),
    ])

    expect(html).toContain('87% of a 5h window')
    expect(html).toContain('7% of a 7d window')
    expect(html).toContain('text-status-warning')
  })

  test('an expired reading is dropped, not shown as a window that ended', () => {
    // What expired is our READING, not the account's window. This machine holds a 5-hour reading
    // from three weeks ago; a row saying "ended 23d ago" states something about the account that is
    // not true, and a percentage from it would be worse.
    const html = render([status({ quotas: [quota(87, -3)] })])

    expect(html).not.toContain('87%')
    expect(html).not.toContain('ended')
    expect(html).not.toContain('window')
  })

  test('a live window beside an expired one is the only row shown', () => {
    const html = render([
      status({
        quotas: [
          { ...quota(45, -500), windowMinutes: 300 },
          { ...quota(8, 107), windowMinutes: 10_080 },
        ],
      }),
    ])

    expect(html).toContain('8% of a 7d window')
    expect(html).not.toContain('5h')
  })
})

describe('agents whose history is outside the range are named', () => {
  /**
   * Measured on a real local history: with the default 30-day range, four of six providers contribute nothing
   * — opencode 0 of 23, Gemini CLI 0 of 29, Copilot 0 of 34, Hermes 0 of 19. Those 105 sessions are in
   * the roster and leave no bar here, and "every figure covers the last 30 days" does not tell a
   * reader that two thirds of their agents are outside it.
   *
   * The set comes from the fold, which is the only place that still holds the excluded rows; this
   * screen only names them. The fold's own test covers WHICH agents land there, including that it
   * respects the provider filter.
   */
  const withOutside = (
    outsideRange: { key: string; sessions: number; updatedAt: number }[],
  ): ExternalAgentStats => ({ ...STATS, outsideRange })

  function renderWith(stats: ExternalAgentStats) {
    return renderToStaticMarkup(
      <StatsView
        stats={stats}
        loading={false}
        error={null}
        onRetry={() => {}}
        providerNames={
          new Map([
            ['hermes', 'Hermes'],
            ['opencode', 'opencode'],
          ])
        }
        providers={[]}
        days="30"
        onChangeDays={() => {}}
      />,
    )
  }

  test('one agent is named with its all-time count', () => {
    const html = renderWith(withOutside([{ key: 'hermes', sessions: 19, updatedAt: Date.now() }]))

    expect(html).toContain('Hermes has 19 session(s) outside the last 30 days')
  })

  test('several are listed together with one total', () => {
    const html = renderWith(
      withOutside([
        { key: 'hermes', sessions: 19, updatedAt: Date.now() },
        { key: 'opencode', sessions: 23, updatedAt: Date.now() },
      ]),
    )

    expect(html).toContain('Hermes, opencode have 42 session(s) outside')
  })

  test('a key with no display name is named by its key rather than dropped', () => {
    const html = renderWith(
      withOutside([{ key: 'gemini-cli', sessions: 29, updatedAt: Date.now() }]),
    )

    expect(html).toContain('gemini-cli has 29 session(s) outside')
  })

  test('nothing is said when every agent contributed', () => {
    expect(renderWith(withOutside([]))).not.toContain('outside')
  })
})

describe('the project axis drills, and the no-cwd bucket does not', () => {
  /**
   * `cwdPrefix` was implemented in the fold and validated by the route while nothing sent one. The
   * project bar's key IS the cwd, so it can — except the fold's synthetic bucket for sessions without
   * one, which is a label and would filter for a directory named after a sentence.
   */
  function render(onSelectProject: (cwd: string) => void) {
    const stats: ExternalAgentStats = {
      ...STATS,
      usage: undefined,
      usageSessions: 0,
      byProject: [
        { key: '/work/app', sessions: 3, updatedAt: Date.now() },
        { key: 'no working directory recorded', sessions: 2, updatedAt: Date.now() },
      ],
    }
    return renderToStaticMarkup(
      <StatsView
        stats={stats}
        loading={false}
        error={null}
        onRetry={() => {}}
        providerNames={new Map()}
        providers={[]}
        days="30"
        onChangeDays={() => {}}
        onSelectProject={onSelectProject}
      />,
    )
  }

  test('the project bars render as selectable controls', () => {
    const html = render(() => {})

    // The chart's own marker for a selectable row — `title="Filter by <key>"`. Asserting `<button`
    // alone was vacuous: the range control renders four of them whatever the chart does.
    expect(html).toContain('Filter by /work/app')
    // The synthetic bucket is a LABEL, not a path, so it must not become a prefix filter.
    expect(html).not.toContain('Filter by no working directory recorded')
  })

  test('a selected project is shown as the active one', () => {
    const html = renderToStaticMarkup(
      <StatsView
        stats={{
          ...STATS,
          usage: undefined,
          usageSessions: 0,
          byProject: [{ key: '/work/app', sessions: 3, updatedAt: Date.now() }],
        }}
        loading={false}
        error={null}
        onRetry={() => {}}
        providerNames={new Map()}
        providers={[]}
        days="30"
        onChangeDays={() => {}}
        onSelectProject={() => {}}
        selectedProject="/work/app"
      />,
    )

    expect(html).toContain('Filter by /work/app')
    // Selected rows carry the chart's active background. `--surface-active`, not a thinned
    // `muted`: under the host's glass theme `muted` is itself a 6% veil, so `/40` of it was a 2.4%
    // fill and a selected filter row was indistinguishable (see `stats-charts.tsx`).
    expect(html).toContain('bg-surface-active')
  })
})

describe('the heaviest-sessions axis filters instead of opening', () => {
  /**
   * It was inert, and the reason was sound: a bucket carries a key and a title but no cwd, so opening
   * from it would hand the import action a session with no project. Filtering by the key sidesteps that
   * — the reader gets the complete row and opens THAT — and it is what every other axis here does.
   *
   * It only became possible once the roster's text search matched a whole key, which it did not: the
   * haystack held the id and the provider separately and never their joined form.
   */
  const KEY = 'claude-code:cc71d515-fee9-422c-a218-b120358ed7be'

  function render(onSelectSession?: (key: string) => void) {
    const stats: ExternalAgentStats = {
      ...STATS,
      usage: {
        inputTokens: 10,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 5,
        reasoningTokens: 0,
        totalTokens: 15,
        requests: 1,
      },
      usageSessions: 1,
      topSessions: [
        { key: KEY, sessions: 1, updatedAt: Date.now(), label: 'Optimise the animation' },
      ],
    }
    return renderToStaticMarkup(
      <StatsView
        stats={stats}
        loading={false}
        error={null}
        onRetry={() => {}}
        providerNames={new Map()}
        providers={[]}
        days="30"
        onChangeDays={() => {}}
        {...(onSelectSession ? { onSelectSession } : {})}
      />,
    )
  }

  test('given a handler, each session bar becomes a filter control keyed by its own key', () => {
    expect(render(() => {})).toContain(`Filter by ${KEY}`)
  })

  test('without one it stays inert, as it was', () => {
    expect(render()).not.toContain('Filter by')
  })
})
