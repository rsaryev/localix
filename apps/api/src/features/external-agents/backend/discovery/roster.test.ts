import { describe, expect, it, beforeEach, afterEach, spyOn, mock } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildRoster, DEFAULT_ROSTER_LIMIT } from './roster'
import { LiveStore } from '../live/store'
import { ManifestRegistry } from '../detection/registry'
import { linkKeyOf } from '../../shared/identity'
import type { SessionSummary } from '../../shared/contracts'

function summary(provider: string, id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    key: linkKeyOf({ provider, nativeSessionId: id }),
    provider,
    nativeSessionId: id,
    title: `${provider} ${id}`,
    updatedAt: 1_000,
    sourcePath: `/tmp/${provider}/${id}`,
    ...over,
  }
}

let live: LiveStore

beforeEach(() => {
  live = new LiveStore(new ManifestRegistry(mkdtempSync(join(tmpdir(), 'as-man-')), () => {}))
})

describe('roster — bounding', () => {
  const many = Array.from({ length: 500 }, (_, i) =>
    summary('claude-code', `s${i}`, { updatedAt: i }),
  )

  it('bounds the page and REPORTS what it withheld', () => {
    const result = buildRoster({ summaries: many, live, query: { limit: 50 } })
    expect(result.items).toHaveLength(50)
    expect(result.total).toBe(500)
    expect(result.withheld).toBe(450)
  })

  it('withheld reaches zero on the last page rather than staying stale', () => {
    const result = buildRoster({ summaries: many, live, query: { limit: 100, offset: 400 } })
    expect(result.items).toHaveLength(100)
    expect(result.withheld).toBe(0)
  })

  it('applies a default limit rather than returning everything', () => {
    const result = buildRoster({ summaries: many, live, query: {} })
    expect(result.items).toHaveLength(DEFAULT_ROSTER_LIMIT)
    expect(result.withheld).toBe(500 - DEFAULT_ROSTER_LIMIT)
  })
})

describe('roster — multi-provider', () => {
  it('holds sessions from every provider in one list, keyed per provider', () => {
    const rows = buildRoster({
      summaries: [
        summary('claude-code', 'c1'),
        summary('claude-code', 'c2'),
        summary('codex', 'x1'),
        summary('opencode', 'o1'),
      ],
      live,
      query: {},
    }).items
    expect(rows).toHaveLength(4)
    expect(new Set(rows.map((r) => r.provider))).toEqual(
      new Set(['claude-code', 'codex', 'opencode']),
    )
  })

  it('keeps two providers apart when they mint the SAME native id', () => {
    const rows = buildRoster({
      summaries: [summary('claude-code', 'same'), summary('codex', 'same')],
      live,
      query: {},
    }).items
    // The key is the `(provider, nativeSessionId)` pair, so a colliding native id is two rows.
    // Keying on the raw id would silently collapse them and cross-talk their transcripts.
    expect(rows).toHaveLength(2)
    expect(new Set(rows.map((r) => r.key)).size).toBe(2)
  })
})

describe('roster — live and historical in one list', () => {
  it('shows a live delegation whose transcript is not yet correlated', () => {
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    const result = buildRoster({ summaries: [], live, query: {} })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].terminalId).toBe('t1')
  })

  it('collapses a correlated delegation onto its own historical row instead of duplicating it', () => {
    const disk = summary('claude-code', 'real-id', { title: 'from disk' })
    const entry = live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.adopt('t1', 'real-id')
    expect(entry.nativeSessionId).toBe('real-id')
    const result = buildRoster({ summaries: [disk], live, query: {} })
    expect(result.items).toHaveLength(1)
    expect(result.items[0].title).toBe('from disk')
    expect(result.items[0].terminalId).toBe('t1')
  })

  it('sorts live rows ahead of historical ones however recent the history is', () => {
    const fresh = summary('codex', 'recent', { updatedAt: Date.now() })
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    const result = buildRoster({ summaries: [fresh], live, query: {} })
    expect(result.items[0].terminalId).toBe('t1')
  })

  it('a live delegation from ANOTHER Localix session is still in the roster', () => {
    // The roster is machine-wide. Nothing about a row is relative to who asked for it, so a
    // delegation opened elsewhere is visible and addressable by key from here.
    live.open({ terminalId: 't-other', localixSessionId: 'lx-other', provider: 'codex' })
    const result = buildRoster({ summaries: [], live, query: {} })
    expect(result.items.map((r) => r.terminalId)).toEqual(['t-other'])
  })
})

describe('roster — an unobserved state says so', () => {
  /**
   * claude-code's manifest has SEVEN rules and not one of them yields `working` (it covers `blocked`
   * and `unknown` only), so a busy Claude Code screen matches nothing and the evaluator falls back
   * to `idle` — the `default_known_agent_idle_fallback`. `authority` cannot carry that: a matched
   * rule and the fallback are both `screen-manifest`. Without `stateFallback` a reader stopping on
   * `idle` cannot tell a finished agent from a working one.
   *
   * The screen here is fed through the REAL manifest, so this also pins that the fallback is
   * reachable in practice rather than asserting a hand-made explain record.
   */
  it('marks an idle that no rule confirmed, and leaves a matched one unmarked', () => {
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.observeScreen('t1', 'Editing src/app.ts\n  writing 40 lines…')

    const fell = buildRoster({ summaries: [], live, query: {} }).items[0]
    expect(fell.state).toBe('idle')
    expect(fell.stateFallback).toBe(true)

    // A screen the manifest does recognise: same authority, but now an actual reading.
    live.observeScreen(
      't1',
      ['─────────', 'Do you want to proceed?', '❯ 1. Yes', '  3. No', 'esc to cancel'].join('\n'),
    )
    const read = buildRoster({ summaries: [], live, query: {} }).items[0]
    expect(read.state).toBe('blocked')
    expect(read.stateFallback).toBeUndefined()
  })

  it('does not carry a fallback mark from one delegation onto another sharing its key', () => {
    // Correlation is ambiguous for concurrent agents, so two terminals CAN land on one session key.
    // The fold must not let the first entry's fallback outlive the second entry's matched rule.
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.adopt('t1', 'shared-id')
    live.observeScreen('t1', 'thinking about the next step')

    live.open({ terminalId: 't2', localixSessionId: 'lx-2', provider: 'claude-code' })
    live.adopt('t2', 'shared-id')
    live.observeScreen(
      't2',
      ['─────────', 'Do you want to proceed?', '❯ 1. Yes', '  3. No', 'esc to cancel'].join('\n'),
    )

    const rows = buildRoster({ summaries: [], live, query: {} }).items
    expect(rows).toHaveLength(1)
    expect(rows[0].terminalId).toBe('t2')
    expect(rows[0].state).toBe('blocked')
    expect(rows[0].stateFallback).toBeUndefined()
  })
})

describe('roster — an uncorrelated delegation gets a NAME, not its launch command', () => {
  /**
   * The title was `entry.launchCommand` verbatim. That command runs to about 1.7 KB — the launch
   * line carries the whole rendered report protocol as one `--append-system-prompt` argument — so
   * one uncorrelated delegation put more into a row title, printed on its own line by the tool,
   * than several ordinary rows of the answer take together.
   */
  const LAUNCH = `LOCALIX_AGENT=claude-code LOCALIX_AGENT_CWD=/work/app claude --append-system-prompt '${'x'.repeat(1_600)}'`

  it('names the agent and where it is working', () => {
    live.open({
      terminalId: 't1',
      localixSessionId: 'lx-1',
      provider: 'claude-code',
      cwd: '/Users/dev/Documents/sample-project',
      launchCommand: LAUNCH,
    })

    const [row] = buildRoster({ summaries: [], live, query: {} }).items

    expect(row.title).toBe('claude-code in sample-project')
    expect(row.title.length).toBeLessThan(80)
  })

  it('falls back to the provider when the launch declared no directory', () => {
    live.open({
      terminalId: 't2',
      localixSessionId: 'lx-1',
      provider: 'codex',
      launchCommand: LAUNCH,
    })

    const [row] = buildRoster({ summaries: [], live, query: {} }).items

    expect(row.title).toBe('codex delegation')
  })

  it('never carries the launch command into the title, however it was launched', () => {
    live.open({
      terminalId: 't3',
      localixSessionId: 'lx-1',
      provider: 'codex',
      cwd: '/work/app',
      launchCommand: LAUNCH,
    })

    const [row] = buildRoster({ summaries: [], live, query: {} }).items

    expect(row.title).not.toContain('append-system-prompt')
    expect(row.title).not.toContain('xxx')
  })
})

describe('roster — a live row is as recent as the screen, not as the file', () => {
  /**
   * `updatedAt` is the MAX of the transcript's own mtime and the last screen observation. A mutation
   * sweep found nothing testing that: replacing it with the disk value alone left every test green.
   *
   * It is not cosmetic. The roster sorts live rows by recency, and a delegation that has been working
   * for an hour without its transcript being flushed would read as the oldest thing on the screen —
   * while its screen is being observed every few seconds.
   */
  it('takes the later of the disk row and the live observation', () => {
    const old = Date.parse('2026-08-01T10:00:00.000Z')
    const disk = summary('claude-code', 'real-id', { updatedAt: old })
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.adopt('t1', 'real-id')
    live.observeScreen('t1', 'still working')

    const [row] = buildRoster({ summaries: [disk], live, query: {} }).items

    expect(row.terminalId).toBe('t1')
    expect(row.updatedAt).toBeGreaterThan(old)
  })

  it('does not move a disk row BACKWARDS to an older observation', () => {
    // The max works both ways: a transcript touched after the last screen reading keeps its own time.
    const fresh = Date.now() + 60_000
    const disk = summary('claude-code', 'real-id', { updatedAt: fresh })
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.adopt('t1', 'real-id')
    live.observeScreen('t1', 'working')

    const [row] = buildRoster({ summaries: [disk], live, query: {} }).items

    expect(row.updatedAt).toBe(fresh)
  })
})

describe('roster — a key can be pasted into the search', () => {
  /**
   * The haystack held the id and the provider separately and never their joined form, so pasting a
   * KEY matched nothing — and the key is what `stats` prints under "Heaviest sessions", what a digest
   * footer names, and what every other action takes. A search that advertises "id" and rejects the id
   * as presented is a dead end with nothing to diagnose it by.
   */
  it('a whole key finds its own row', () => {
    const rows = [summary('claude-code', 'cc71d515'), summary('codex', 'other')]

    const found = buildRoster({ summaries: rows, live, query: { text: 'claude-code:cc71d515' } })

    expect(found.items.map((row) => row.key)).toEqual(['claude-code:cc71d515'])
  })

  it('a prefix of a key still finds it, as any other term would', () => {
    const rows = [summary('claude-code', 'cc71d515'), summary('codex', 'other')]

    const found = buildRoster({ summaries: rows, live, query: { text: 'claude-code:cc71' } })

    expect(found.items).toHaveLength(1)
  })

  it('a key belonging to nothing here matches nothing, rather than everything', () => {
    const rows = [summary('claude-code', 'cc71d515')]

    const found = buildRoster({ summaries: rows, live, query: { text: 'codex:absent' } })

    expect(found.items).toEqual([])
  })
})

describe('roster — a still screen is evidence a state cannot give', () => {
  /**
   * `idle` that nothing confirmed says only that no rule matched. How long the screen has been STILL is
   * what separates a delegation that finished from one that is stuck, and it is the only such signal
   * Claude Code can give: its manifest yields no positive `working` state at all.
   *
   * Symphony measures the same thing — elapsed time since the last agent event, not since the run
   * started (SPEC.md:825) — and retries the worker on it.
   */
  let now = 0
  beforeEach(() => {
    now = 1_000_000
    spyOn(Date, 'now').mockImplementation(() => now)
  })
  afterEach(() => mock.restore())

  it('a redraw of the SAME screen is not a change', async () => {
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.observeScreen('t1', 'working on it')
    const first = buildRoster({ summaries: [], live, query: {} }).items[0]?.lastChangeAt

    now += 5
    live.observeScreen('t1', 'working on it')
    const again = buildRoster({ summaries: [], live, query: {} }).items[0]

    expect(first).toBeDefined()
    expect(again.lastChangeAt).toBe(first)
    // Observed later, though: the two answer different questions.
    expect(again.updatedAt).toBeGreaterThanOrEqual(first as number)
  })

  it('a screen that differs moves the change time forward', async () => {
    live.open({ terminalId: 't2', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.observeScreen('t2', 'step 1')
    const first = buildRoster({ summaries: [], live, query: {} }).items[0]?.lastChangeAt

    now += 5
    live.observeScreen('t2', 'step 2')
    const moved = buildRoster({ summaries: [], live, query: {} }).items[0]?.lastChangeAt

    expect(moved).toBeGreaterThan(first as number)
  })

  it('a historical row has no change time, because nothing is watching it', () => {
    const disk = summary('codex', 'old')

    const [row] = buildRoster({ summaries: [disk], live, query: {} }).items

    expect(row.lastChangeAt).toBeUndefined()
  })
})

describe('roster — filtering', () => {
  const rows = [
    summary('claude-code', 'a', { title: 'refactor parser', cwd: '/repo/one' }),
    summary('codex', 'b', { title: 'fix login', cwd: '/repo/two' }),
    summary('opencode', 'c', { title: 'refactor login flow', cwd: '/repo/one' }),
  ]

  it('requires every text term to match', () => {
    expect(
      buildRoster({ summaries: rows, live, query: { text: 'refactor login' } }).items,
    ).toHaveLength(1)
    expect(buildRoster({ summaries: rows, live, query: { text: 'refactor' } }).items).toHaveLength(
      2,
    )
  })

  it('filters by provider and by cwd prefix', () => {
    expect(
      buildRoster({ summaries: rows, live, query: { providers: ['codex'] } }).items,
    ).toHaveLength(1)
    expect(
      buildRoster({ summaries: rows, live, query: { cwdPrefix: '/repo/one' } }).items,
    ).toHaveLength(2)
  })

  it('hides sub-agent transcripts by default and shows them on request', () => {
    const child = summary('claude-code', 'child', { parentNativeSessionId: 'a' })
    expect(buildRoster({ summaries: [...rows, child], live, query: {} }).items).toHaveLength(3)
    expect(
      buildRoster({ summaries: [...rows, child], live, query: {}, includeChildren: true }).items,
    ).toHaveLength(4)
  })

  it('never hides a child that is LIVE, whatever the default is', () => {
    const child = summary('claude-code', 'child', { parentNativeSessionId: 'a' })
    live.open({ terminalId: 't1', localixSessionId: 'lx-1', provider: 'claude-code' })
    live.adopt('t1', 'child')
    const result = buildRoster({ summaries: [...rows, child], live, query: {} })
    expect(result.items.some((r) => r.key === child.key)).toBe(true)
  })
})

describe('a parent selects the sub-agents it spawned', () => {
  /**
   * The fan-out axis names a session and a number — "200 sub-agents" — and the only way to act on
   * it was a text search for that key, which returns the PARENT: one row where the bar promised
   * hundreds. `parentKey` returns them all.
   */
  const parent = summary('claude-code', 'p1')
  const kids = Array.from({ length: 3 }, (_, i) =>
    summary('claude-code', `c${i}`, { parentNativeSessionId: 'p1' }),
  )

  it('returns the children, not the session whose key was given', () => {
    const rows = buildRoster({
      summaries: [parent, ...kids],
      live,
      query: { parentKey: parent.key },
    })

    expect(rows.items.map((row) => row.nativeSessionId).sort()).toEqual(['c0', 'c1', 'c2'])
  })

  it('overrides the default that hides children, which would otherwise answer with nothing', () => {
    // Asking for children while hiding children is a query with one answer and it is the wrong one.
    const rows = buildRoster({
      summaries: [parent, ...kids],
      live,
      query: { parentKey: parent.key },
      includeChildren: false,
    })

    expect(rows.total).toBe(3)
  })

  it('matches within a provider, since a native id is unique only there', () => {
    const stranger = summary('codex', 'x', { parentNativeSessionId: 'p1' })
    const rows = buildRoster({
      summaries: [parent, stranger, ...kids],
      live,
      query: { parentKey: parent.key },
    })

    expect(rows.items.map((row) => row.provider)).toEqual([
      'claude-code',
      'claude-code',
      'claude-code',
    ])
  })

  it('composes with the filters beside it rather than replacing them', () => {
    const rows = buildRoster({
      summaries: [parent, ...kids],
      live,
      query: { parentKey: parent.key, text: 'c1' },
    })

    expect(rows.items.map((row) => row.nativeSessionId)).toEqual(['c1'])
  })

  it('a parent with no children returns nothing, rather than falling back to everything', () => {
    const rows = buildRoster({
      summaries: [parent, ...kids],
      live,
      query: { parentKey: 'codex:none' },
    })

    expect(rows.total).toBe(0)
  })
})
