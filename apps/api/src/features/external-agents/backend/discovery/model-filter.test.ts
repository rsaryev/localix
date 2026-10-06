/**
 * The model filter, run through BOTH folds from one set of sessions.
 *
 * A session names its model in one of two places and never in both. Measured on a real local history when
 * this was written: 22 of 283 rows carry `SessionSummary.model` — Copilot writes `selectedModel`
 * once at the top of its log, Hermes keeps a `model` column — while the other 261 carry no such
 * field and attribute per-model token usage instead. A predicate that checked either alone would
 * answer for a twelfth of the corpus or for the rest of it.
 *
 * Both surfaces read that predicate from `shared/contracts`, which is what this file protects: the
 * same question asked of the statistics and of the roster has to select the same sessions, or a
 * reader drills a bar of 17 and lands in a list of 4.
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
import { sessionUsedModel } from '../../shared/contracts'
import type { SessionSummary, SessionTokenUsage } from '../../shared/contracts'

const NOW = Date.parse('2026-08-07T12:00:00.000Z')

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

/** How the four JSONL providers report it: no `model` field, one entry per model in the usage. */
function usageOn(...models: string[]): SessionTokenUsage {
  return {
    ...counters(models.length * 100),
    byModel: models.map((model) => ({ model, ...counters(100) })),
    byDay: [{ day: '2026-08-07', byModel: [], ...counters(models.length * 100) }],
  }
}

function summary(id: string, over: Partial<SessionSummary> = {}): SessionSummary {
  const provider = over.provider ?? 'codex'
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

const SESSIONS: readonly SessionSummary[] = [
  // Attributes through usage, the majority case.
  summary('via-usage', { usage: usageOn('claude-opus-5') }),
  // Two models in one session: a long session that switched. It belongs to BOTH.
  summary('switched', { usage: usageOn('claude-opus-5', 'claude-fable-5') }),
  // Names its own model and reports no usage at all — Copilot's shape.
  summary('via-field', { provider: 'github-copilot', model: 'gpt-5.4' }),
  // Names its model AND reports usage under the same name — Hermes' shape.
  summary('both', {
    provider: 'hermes',
    model: 'deepseek/deepseek-v4-pro',
    usage: usageOn('deepseek/deepseek-v4-pro'),
  }),
  summary('unrelated', { usage: usageOn('gpt-5.6-sol') }),
]

let live: LiveStore

beforeEach(() => {
  live = new LiveStore(new ManifestRegistry(mkdtempSync(join(tmpdir(), 'as-model-')), () => {}))
})

function rosterKeys(model?: string): string[] {
  const query = model ? { limit: 100, model } : { limit: 100 }
  return buildRoster({ summaries: SESSIONS, live, query }).items.map((row) => row.nativeSessionId)
}

describe('the predicate reads both places a model is recorded', () => {
  it('matches a session that only reports usage', () => {
    expect(sessionUsedModel(SESSIONS[0]!, 'claude-opus-5')).toBe(true)
  })

  it('matches a session that only names its model', () => {
    expect(sessionUsedModel(SESSIONS[2]!, 'gpt-5.4')).toBe(true)
  })

  it('is exact, so one model does not select another it is a prefix of', () => {
    // `claude-opus-5` and `claude-opus-4-8` share a stem; a startsWith test would merge two bars.
    expect(sessionUsedModel(SESSIONS[0]!, 'claude-opus')).toBe(false)
  })
})

describe('both folds select the same sessions', () => {
  for (const model of ['claude-opus-5', 'gpt-5.4', 'deepseek/deepseek-v4-pro']) {
    it(`agrees on ${model}`, () => {
      const stats = computeStats(SESSIONS, { days: 30, model }, NOW)
      const roster = rosterKeys(model)

      expect(roster.length).toBeGreaterThan(0)
      // The count a bar shows and the number of rows a drill lands in are the same number.
      expect(stats.sessions).toBe(roster.length)
    })
  }

  it('keeps a session that ran on two models on both of their filters', () => {
    expect(rosterKeys('claude-opus-5')).toContain('switched')
    expect(rosterKeys('claude-fable-5')).toContain('switched')
  })

  it('selects nothing for a model no session ran on, rather than everything', () => {
    expect(rosterKeys('gpt-4o')).toEqual([])
    expect(computeStats(SESSIONS, { days: 30, model: 'gpt-4o' }, NOW).sessions).toBe(0)
  })

  it('leaves the corpus whole when no model is asked for', () => {
    expect(rosterKeys()).toHaveLength(SESSIONS.length)
    expect(computeStats(SESSIONS, { days: 30 }, NOW).sessions).toBe(SESSIONS.length)
  })
})

describe('the filter composes with the ones beside it', () => {
  it('narrows to the intersection, not to whichever was applied last', () => {
    const stats = computeStats(
      SESSIONS,
      { days: 30, model: 'claude-opus-5', providers: ['hermes'] },
      NOW,
    )

    expect(stats.sessions).toBe(0)
  })

  it('still lists every agent on the drill control, so the filter can be left', () => {
    // The agent axis deliberately folds over the unfiltered set: a control that deletes its own
    // options is a dead end. Measured here as "more agents on the axis than in the selection".
    const stats = computeStats(SESSIONS, { days: 30, model: 'gpt-5.4' }, NOW)

    expect(stats.sessions).toBe(1)
    expect(stats.byProvider.length).toBeGreaterThan(1)
  })
})
