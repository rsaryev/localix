/**
 * A bar says a number. Clicking it must produce that many rows.
 *
 * This has failed twice in a row, in the same shape and for different axes: the model filter checked
 * one of the two places a model is recorded, and the fan-out bar filtered by the parent's own key —
 * "208 sub-agents" landing in a list of one. Both passed every test that existed, because each
 * surface was tested against itself. Nothing compared the two.
 *
 * So this compares them: one corpus, folded into statistics, then each axis drilled through the
 * roster with the query its bar is wired to. It is deliberately mechanical — the point is that a new
 * axis must be added here too, and adding it is what surfaces the question "what query is this bar
 * actually wired to?" before a reader has to ask it.
 *
 * The one legitimate difference is pinned rather than hidden: `byProject` buckets by EXACT working
 * directory while `cwdPrefix` selects a subtree, so a project with a sub-project under it drills
 * into more rows than its own bar shows — a session recorded under `<project>/packages/frontend`,
 * for example.
 */

import { describe, expect, it, beforeEach } from 'bun:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { buildRoster } from './roster'
import { computeStats } from './stats'
import { LiveStore } from '../live/store'
import { ManifestRegistry } from '../detection/registry'
import { linkKeyOf } from '../../shared/identity'
import type { SessionSummary, SessionTokenUsage } from '../../shared/contracts'

const NOW = Date.parse('2026-08-08T12:00:00.000Z')

function counters(total: number) {
  return {
    inputTokens: total,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: total,
    requests: 1,
  }
}

function usageOn(model: string): SessionTokenUsage {
  return {
    ...counters(100),
    byModel: [{ model, ...counters(100) }],
    // The per-model breakdown must be inside the DAY too: the axis folds usage within the window,
    // and a day bucket with no models contributes no models — which is a fixture that quietly tests
    // nothing, not a corpus.
    byDay: [{ day: '2026-08-08', byModel: [{ model, ...counters(100) }], ...counters(100) }],
  }
}

function session(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  const provider = over.provider ?? 'claude-code'
  return {
    key: linkKeyOf({ provider, nativeSessionId: id }),
    provider,
    nativeSessionId: id,
    title: id,
    updatedAt: NOW - 3_600_000,
    sourcePath: `/tmp/${id}.jsonl`,
    ...over,
  }
}

/**
 * A corpus that lights up every axis at once: two agents, a project with a sub-project beneath it,
 * two models, a parent with children, and one session heavy enough to rank.
 */
const CORPUS: readonly SessionSummary[] = [
  session('a1', { cwd: '/work/app', usage: usageOn('claude-opus-5') }),
  session('a2', { cwd: '/work/app', usage: usageOn('claude-opus-5') }),
  session('a3', { cwd: '/work/app/packages/ui', usage: usageOn('gpt-5.4') }),
  session('b1', { provider: 'codex', cwd: '/work/other', usage: usageOn('gpt-5.4') }),
  // Records its model on the ROW and reports no usage — Copilot's and Hermes' shape, and 22 of this
  // machine's 283 sessions. Without one of these, breaking the usage half of the model predicate
  // breaks the axis and the drill together, and they agree on the wrong answer.
  session('d1', { provider: 'github-copilot', cwd: '/work/app', model: 'gpt-5.4' }),
  session('p1', { cwd: '/work/app', usage: usageOn('claude-opus-5') }),
  session('c1', { cwd: '/work/app', parentNativeSessionId: 'p1' }),
  session('c2', { cwd: '/work/app', parentNativeSessionId: 'p1' }),
  session('c3', { provider: 'codex', cwd: '/work/other', parentNativeSessionId: 'p1' }),
]

let live: LiveStore

beforeEach(() => {
  live = new LiveStore(new ManifestRegistry(mkdtempSync(join(tmpdir(), 'as-agree-')), () => {}))
})

const stats = () => computeStats(CORPUS, { days: 30 }, NOW)
const rows = (query: Record<string, unknown>) =>
  buildRoster({ summaries: CORPUS, live, query: { limit: 100, ...query } }).total

describe('every axis returns the count it printed', () => {
  it('every axis has bars at all, or the comparisons below are vacuous', () => {
    // An axis that folds to nothing makes a for-loop over it pass without comparing anything. This
    // is the assertion that keeps the rest of the file honest.
    const folded = stats()
    expect(folded.byProvider.length).toBeGreaterThan(1)
    expect(folded.byModel.length).toBeGreaterThan(1)
    expect(folded.byProject.length).toBeGreaterThan(1)
    expect(folded.byParent.length).toBeGreaterThan(0)
    expect(folded.topSessions.length).toBeGreaterThan(0)
  })

  it('by agent — the bar is a provider filter', () => {
    for (const bucket of stats().byProvider) {
      expect(rows({ providers: [bucket.key] }), `provider ${bucket.key}`).toBe(bucket.sessions)
    }
  })

  it('by model — the bar is a model filter', () => {
    for (const bucket of stats().byModel) {
      expect(rows({ model: bucket.key }), `model ${bucket.key}`).toBe(bucket.sessions)
    }
  })

  it('by parent — the bar is a parentKey filter, and counts CHILDREN', () => {
    for (const bucket of stats().byParent) {
      expect(rows({ parentKey: bucket.key }), `parent ${bucket.key}`).toBe(bucket.sessions)
    }
  })

  it('heaviest sessions — one bar, one row', () => {
    for (const bucket of stats().topSessions) {
      expect(rows({ text: bucket.key, includeChildren: true }), `session ${bucket.key}`).toBe(1)
    }
  })

  it('by project — exact for a leaf project', () => {
    const leaf = stats().byProject.find((bucket) => bucket.key === '/work/other')

    expect(leaf?.sessions).toBe(1)
    expect(rows({ cwdPrefix: '/work/other' })).toBe(1)
  })
})

describe('the one place the two legitimately differ says so', () => {
  it('a project with a sub-project drills wider than its own bar', () => {
    // The axis buckets by EXACT cwd; `cwdPrefix` selects the subtree, so a session recorded under
    // `<project>/packages/frontend` drills in but sits outside the bar.
    const bucket = stats().byProject.find((entry) => entry.key === '/work/app')

    expect(bucket?.sessions).toBe(4)
    expect(rows({ cwdPrefix: '/work/app' })).toBe(5)
  })

  it('and the sub-project has its own bar, so nothing is uncounted', () => {
    const sub = stats().byProject.find((entry) => entry.key === '/work/app/packages/ui')

    expect(sub?.sessions).toBe(1)
  })
})
