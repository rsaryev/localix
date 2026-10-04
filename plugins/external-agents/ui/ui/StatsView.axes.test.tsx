/**
 * The distribution axes: which of them render, and which of them a reader can act on.
 *
 * One slot in the top grid holds two axes — models when usage was measured, projects when it was
 * not — and a dedicated project section renders below whenever usage exists, so neither case leaves
 * the reader without a project breakdown. Measured on a real local history's 30-day range: 126 of 135
 * sessions carry usage, so the slot ordinarily shows models.
 *
 * What was missing was not a section but a HANDLER. Every other axis here narrows the workspace when
 * clicked; the model axis was the one bar that only ever read back a number, even though the roster
 * and the statistics both accept the filter behind it. `title="Filter by <key>"` is the chart's own
 * attribute for a selectable bar, so its presence is the difference between a figure and a control.
 */

import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import { StatsView } from './StatsView'
import type { ExternalAgentStats, StatBucket } from '../model/types'

const HOUR = 3_600_000

function bucket(key: string, sessions: number, tokens?: number): StatBucket {
  return {
    key,
    sessions,
    messages: sessions * 10,
    // The contract requires it and the axes order by it. Untyped, this helper produced a shape
    // that was not a `StatBucket` at all — which is why every caller had to cast, and a cast is how
    // a fixture stops being checked.
    updatedAt: Date.parse('2026-08-08T00:00:00.000Z'),
    ...(tokens === undefined
      ? {}
      : {
          usage: {
            inputTokens: tokens,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 0,
            reasoningTokens: 0,
            totalTokens: tokens,
            requests: 1,
          },
        }),
  }
}

function stats(over: Partial<ExternalAgentStats> = {}): ExternalAgentStats {
  return {
    sessions: 135,
    messages: 4_000,
    usageSessions: 126,
    projects: 10,
    firstAt: Date.now() - 30 * 24 * HOUR,
    lastAt: Date.now(),
    medianDurationMs: 60_000,
    // `hasUsage` is BOTH of these: a count of sessions that measured usage and the aggregate itself.
    usage: {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
      reasoningTokens: 0,
      totalTokens: 1_100_000,
      requests: 900,
    },
    byProvider: [bucket('codex', 60, 500_000)],
    byProject: [bucket('/Users/dev/Documents/sample-project', 90, 900_000)],
    byModel: [bucket('claude-opus-5', 70, 700_000)],
    topSessions: [],
    byParent: [],
    byDay: [],
    activeDays: 20,
    bucketDays: 1,
    outsideRange: [],
    ...over,
  } as ExternalAgentStats
}

function render(over: Partial<ExternalAgentStats> = {}, props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    <StatsView
      stats={stats(over)}
      loading={false}
      error={null}
      onRetry={() => {}}
      providerNames={new Map([['codex', 'Codex']])}
      providers={[]}
      days="30"
      onChangeDays={() => {}}
      {...props}
    />,
  )
}

/** The bar itself, not the range control above it, which carries `aria-pressed` on every render. */
function bar(html: string, key: string): string | undefined {
  const at = html.indexOf(`title="Filter by ${key}"`)
  if (at < 0) return undefined
  return html.slice(html.lastIndexOf('<button', at), html.indexOf('>', at) + 1)
}

describe('a project breakdown is on screen in both cases', () => {
  test('with usage the slot shows models and the section below shows projects', () => {
    const html = render()

    expect(html).toContain('By model')
    expect(html).toContain('claude-opus-5')
    expect(html).toContain('sample-project')
  })

  test('without usage the same slot becomes the project axis', () => {
    const html = render({ usageSessions: 0, byModel: [], usage: undefined })

    expect(html).not.toContain('By model')
    expect(html).toContain('sample-project')
  })
})

describe('a truncated axis states everything it hides, not only its own half', () => {
  /**
   * Two truncations sit between the data and the bars: the fold caps the project axis at twelve
   * buckets, and the chart draws a top eight. The chart could only report what IT dropped, so with
   * 17 projects distinct, 12 kept and 8 drawn, the label read "+4 not drawn" while 9 were — and the
   * five dropped upstream held 17 sessions that no figure on the screen accounted for.
   */
  const many = Array.from({ length: 12 }, (_, i) => bucket(`/work/p${i}`, 12 - i, 1000 * (12 - i)))

  test('the count spans the fold as well as the chart', () => {
    const html = render({ byProject: many, projects: 17 })

    // 17 distinct, 8 drawn.
    expect(html).toContain('+9 not drawn')
  })

  test('with nothing dropped upstream it reports the chart alone', () => {
    const html = render({ byProject: many, projects: 12 })

    expect(html).toContain('+4 not drawn')
  })
})

describe('the fan-out axis appears only when something delegated', () => {
  const PARENT: StatBucket = {
    key: 'claude-code:p1',
    label: 'the orchestrator',
    sessions: 208,
    messages: 0,
    updatedAt: Date.parse('2026-08-08T00:00:00.000Z'),
  }

  test('the tile totals what the axis ranks', () => {
    const html = render({
      byParent: [PARENT, { ...PARENT, key: 'claude-code:p2', sessions: 12 }],
    })

    // 208 + 12, so the tile and the bars below cannot disagree.
    expect(html).toContain('220')
  })

  test('with no parentage recorded the tile says nothing rather than zero', () => {
    // Three of the six providers record no parentage at all; "0" would say those agents delegated
    // nothing instead of saying nothing was recorded.
    const html = render()

    expect(html).toContain('Sub-agents')
    expect(html).not.toContain('>0<')
  })

  test('it names the session and counts its sub-agents', () => {
    const html = render({ byParent: [PARENT] })

    expect(html).toContain('Most delegating sessions')
    expect(html).toContain('the orchestrator')
    expect(html).toContain('208 sub-agents')
  })

  test('with nothing delegating, the section is absent rather than empty', () => {
    // An empty axis about delegation reads as "nobody delegates" instead of "this window holds no
    // parents", which is a claim the data does not make.
    expect(render()).not.toContain('Most delegating sessions')
  })

  test('one sub-agent is not "1 sub-agents"', () => {
    const html = render({ byParent: [{ ...PARENT, sessions: 1 }] })

    expect(html).toContain('1 sub-agent<')
  })

  test('it drills to the CHILDREN, not to the session whose key is on the bar', () => {
    // `onSelectSession` filters the roster by the key clicked, which for this bar is the parent —
    // a bar of 208 landing in a list of 1. The fan-out axis takes its own handler for that reason.
    const bySession = render({ byParent: [PARENT] }, { onSelectSession: () => {} })
    const byParent = render({ byParent: [PARENT] }, { onSelectParent: () => {} })

    expect(bySession).not.toContain('Filter by claude-code:p1')
    expect(byParent).toContain('Filter by claude-code:p1')
  })
})

describe('the model bar acts, not just reads', () => {
  test('it becomes a filter control when the workspace offers the drill', () => {
    expect(bar(render({}, { onSelectModel: () => {} }), 'claude-opus-5')).toBeDefined()
  })

  test('the project drill is unaffected by it', () => {
    const html = render({}, { onSelectModel: () => {}, onSelectProject: () => {} })

    expect(bar(html, 'claude-opus-5')).toBeDefined()
    expect(bar(html, '/Users/dev/Documents/sample-project')).toBeDefined()
  })

  test('without a handler the same figure renders as text', () => {
    const html = render()

    expect(html).toContain('claude-opus-5')
    expect(bar(html, 'claude-opus-5')).toBeUndefined()
  })

  test('the chosen model is marked on the bar it was chosen from', () => {
    const selected = render({}, { onSelectModel: () => {}, selectedModel: 'claude-opus-5' })
    const other = render({}, { onSelectModel: () => {}, selectedModel: 'gpt-5.4' })

    expect(bar(selected, 'claude-opus-5')).toContain('aria-pressed="true"')
    expect(bar(other, 'claude-opus-5')).toContain('aria-pressed="false"')
  })
})
