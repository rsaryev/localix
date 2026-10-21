import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveTipSignals, type TipFacts } from './tipSignals'
import { TIP_SIGNALS } from '@/shared/api/tips'

const QUIET: TipFacts = {
  queued: 0,
  loops: 0,
  monitors: 0,
  turns: 2,
  contextFraction: 0.1,
  sessionCount: 50,
}

const signals = (over: Partial<TipFacts> = {}) => resolveTipSignals({ ...QUIET, ...over })

describe('resolveTipSignals', () => {
  test('a quiet session reports no live signals', () => {
    expect([...signals()]).toEqual([])
  })

  test('the context signal follows the same fraction the ring shows', () => {
    expect(signals({ contextFraction: 0.69 }).has('context-tight')).toBe(false)
    expect(signals({ contextFraction: 0.7 }).has('context-tight')).toBe(true)
    // An unknown fraction is not a tight one — a tip must not fire on a missing number.
    expect(signals({ contextFraction: null }).has('context-tight')).toBe(false)
  })

  test('length is counted from whichever measure is larger', () => {
    expect(signals({ turns: 39 }).has('session-long')).toBe(false)
    expect(signals({ turns: 40 }).has('session-long')).toBe(true)
  })

  test('the live-session facts each map to their own signal', () => {
    expect(signals({ queued: 1 }).has('queue-nonempty')).toBe(true)
    expect(signals({ loops: 1 }).has('loops-active')).toBe(true)
    expect(signals({ monitors: 1 }).has('monitors-active')).toBe(true)
    expect(signals({ sessionCount: 3 }).has('first-session')).toBe(true)
    expect(signals({ sessionCount: 4 }).has('first-session')).toBe(false)
    // Not loaded yet is not the same as new — see the note in the resolver.
    expect(signals({ sessionCount: 0 }).has('first-session')).toBe(false)
  })
})

/**
 * The contract's own claim, checked.
 *
 * A signal the server may gate a tip on and the client never sets is a tip that can
 * never appear — and nothing fails when that happens, which is why it is worth a
 * test. Every member of the vocabulary must be produced somewhere on this side:
 * `run-long` by the tip hook (which already holds the run clock), the rest here.
 */
describe('every signal in the vocabulary is resolved', () => {
  const ALL_FACTS: TipFacts = {
    queued: 1,
    loops: 1,
    monitors: 1,
    turns: 100,
    contextFraction: 0.95,
    sessionCount: 1,
  }

  test('the resolver plus the run clock cover it', () => {
    const resolved = new Set<string>(signals(ALL_FACTS))
    const timedByTheHook = readFileSync(join(import.meta.dir, 'streamTips.ts'), 'utf8')
    // The vocabulary itself, not a copy of it: a member added on the server fails
    // here until something on this side answers it.
    for (const signal of TIP_SIGNALS) {
      expect(resolved.has(signal) || timedByTheHook.includes(`'${signal}'`)).toBe(true)
    }
  })
})
