/**
 * The hints are a claim ABOUT content the model can no longer see, made in the one place it
 * cannot check them — so the properties that matter are the ones that keep the claim honest
 * and cheap: every term occurs in the source, nothing generic is emitted, the clause stays
 * far smaller than what eliding saved, and a body too small to be worth it gets nothing.
 */
import { describe, expect, test } from 'bun:test'
import {
  hintClause,
  vocabularyHints,
  HINT_MIN_SOURCE_CHARS,
  MAX_HINTS,
  MAX_HINT_CHARS,
} from './vocab-hints'
import { elidedPointer, readPointer } from './pointers'

/** A realistic elided body: a stack trace + code, comfortably over the gate. */
const DUMP = `
Error: ENOENT: no such file or directory, open '/app/src/features/chat/runtime/checkpoint.ts'
    at Object.readFileSync (node:fs:1234:5)
    at loadCheckpointPlan (/app/src/features/chat/runtime/checkpoint.ts:88:14)
    at buildEpochCardPrompt (/app/src/features/chat/runtime/checkpoint-cards.ts:99:3)
  errno: -2,
  code: 'ENOENT',
  syscall: 'open'
TS2345: Argument of type 'CheckpointPlan' is not assignable to parameter of type 'PruneRule'.
${'the quick brown fox jumps over the lazy dog and returns a value from the list of items\n'.repeat(20)}
`.padEnd(HINT_MIN_SOURCE_CHARS + 500, ' ')

describe('vocabularyHints', () => {
  test('every term it names actually occurs in the source', () => {
    const hints = vocabularyHints(DUMP)
    expect(hints.length).toBeGreaterThan(0)
    for (const h of hints) expect(DUMP).toContain(h)
  })

  test('it names the distinctive things — paths, error codes, identifiers', () => {
    const joined = vocabularyHints(DUMP).join(' ')
    expect(joined).toContain('checkpoint')
    expect(joined).toMatch(/ENOENT|TS2345|buildEpochCardPrompt|CheckpointPlan/)
  })

  test('it never names a term that would select nothing', () => {
    const hints = vocabularyHints(DUMP).map((h) => h.toLowerCase())
    for (const generic of ['the', 'value', 'items', 'error', 'returns', 'type', 'from', 'quick'])
      expect(hints).not.toContain(generic)
  })

  test('bounded: at most MAX_HINTS terms and MAX_HINT_CHARS of them', () => {
    const many = Array.from({ length: 400 }, (_, i) => `distinctIdent${i}.field${i}`).join(' ')
    const hints = vocabularyHints(many)
    expect(hints.length).toBeLessThanOrEqual(MAX_HINTS)
    expect(hints.join(', ').length).toBeLessThanOrEqual(MAX_HINT_CHARS)
  })

  test('`max` narrows it further', () => {
    expect(vocabularyHints(DUMP, 3).length).toBeLessThanOrEqual(3)
    expect(vocabularyHints(DUMP, 0)).toEqual([])
  })

  test('a body too small for the hints to pay for themselves gets none', () => {
    const small = 'loadCompactionPlan failed with ENOENT at /app/src/index.ts'
    expect(small.length).toBeLessThan(HINT_MIN_SOURCE_CHARS)
    expect(vocabularyHints(small)).toEqual([])
    // …and the same text over the gate does produce them, so the guard above is the gate
    // talking and not the heuristic finding nothing.
    expect(vocabularyHints(small.repeat(60)).length).toBeGreaterThan(0)
  })

  test('prose, or a wall of one byte, yields nothing rather than noise', () => {
    expect(vocabularyHints('x'.repeat(5000))).toEqual([])
    expect(vocabularyHints('the quick brown fox jumps over the lazy dog. '.repeat(200))).toEqual([])
  })

  /**
   * Both of these outranked every real identifier at some point during tuning, which is the
   * failure mode that matters: the hints were still true, and still useless.
   */
  test('a slash is not a path and a word is not an extension', () => {
    const text =
      `${'read/write I/O bash log env and/or true/false '.repeat(120)}pruneWireMessages `.repeat(2)
    const hints = vocabularyHints(text)
    // A bare word is never a file name, however many extensions share its spelling.
    for (const word of ['bash', 'log', 'env']) expect(hints).not.toContain(word)
    // The prose slashes are still true of the text, so they may fill LEFTOVER budget — but
    // they must never outrank the one real name in it (they used to take all 12 slots,
    // each of them a term that selects nothing).
    expect(hints[0]).toBe('pruneWireMessages')
  })

  test('a real identifier outranks a member access on the same receiver', () => {
    const text = `${'r.id m.role tc.id '.repeat(200)}${'elideToolCallArgs '.repeat(3)}`
    expect(vocabularyHints(text, 1)).toEqual(['elideToolCallArgs'])
  })

  test('a long path is shortened to its tail — still a substring, a fraction of the budget', () => {
    const path = 'app/src/features/chat/runtime/checkpoint-cards.ts'
    const hints = vocabularyHints(`${path} exploded\n`.repeat(80))
    const hit = hints.find((h) => path.includes(h) && h.includes('/'))
    expect(hit).toBe('runtime/checkpoint-cards.ts')
  })

  test('terms are deduped case-insensitively, keeping the spelling that occurs', () => {
    const text = 'ChartCanvas chartcanvas ChartCanvas '.repeat(80)
    const hints = vocabularyHints(text)
    expect(hints).toEqual(['ChartCanvas'])
  })
})

describe('hintClause', () => {
  test('reads as a route into the retrievable content, and stays small', () => {
    const clause = hintClause(DUMP)
    expect(clause).toStartWith('; terms found in it: ')
    // Far cheaper than the body it describes: the whole point of the trade.
    expect(clause.length).toBeLessThan(DUMP.length / 8)
  })

  test('empty when there is nothing worth saying', () => {
    expect(hintClause('short')).toBe('')
  })
})

/**
 * The pointer prose is pinned byte-exact elsewhere (`pointers.test.ts`) — that pin is what
 * makes the hints ADDITIVE: without a source, or under the gate, nothing changes.
 */
describe('the pointers carry the hints without disturbing what they said before', () => {
  test('no source → the historical pointer, byte for byte', () => {
    expect(elidedPointer('output', 42, 'tc1', undefined)).toBe(elidedPointer('output', 42, 'tc1'))
  })

  test('a LIVE read pointer gains the terms, and keeps the handle', () => {
    const text = readPointer('live', DUMP.length, 'tc1', DUMP)
    expect(text).toContain('ToolOutput(action="get", tool_call_id="tc1")')
    expect(text).toContain('; terms found in it: ')
  })

  test('a STALE read names no terms — it must not invite a query for bytes that are gone', () => {
    const text = readPointer('stale', DUMP.length, 'tc1', DUMP)
    expect(text).not.toContain('terms found in it')
    expect(text).toContain('read the file again')
  })

  test('a REFRESHED read names none either — the answer is further down the wire', () => {
    expect(readPointer('refreshed', DUMP.length, 'tc1', DUMP)).not.toContain('terms found in it')
  })
})

test('keeps the first qualifying spelling and source order when ranks tie', () => {
  const body = (terms: string) => terms.padEnd(HINT_MIN_SOURCE_CHARS, ' ')
  expect(vocabularyHints(body('chartcanvas ChartCanvas CHARTCANVAS'))).toEqual(['ChartCanvas'])
  expect(vocabularyHints(body('AlphaCase OtherCase'), 2)).toEqual(['AlphaCase', 'OtherCase'])
  expect(vocabularyHints(body('OtherCase AlphaCase'), 2)).toEqual(['OtherCase', 'AlphaCase'])
})
