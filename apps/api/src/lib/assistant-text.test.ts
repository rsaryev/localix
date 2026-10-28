import { describe, expect, test } from 'bun:test'
import { assistantText } from './assistant-text'

/**
 * These are RUNTIME assertions on purpose. `apps/api/tsconfig.json` excludes
 * `src/**\/*.test.ts` and `bun test` does not type-check, so a compile-time guard
 * written here would be checked by nothing at all. Every rule below is executed.
 */
describe('assistantText', () => {
  test('concatenates text blocks and ignores thinking / tool-call blocks', () => {
    const content = [
      { type: 'text', text: 'Build ' },
      { type: 'thinking', text: 'hmm, let me think' },
      { type: 'tool_call', id: 't1', name: 'Read', arguments: '{}' },
      { type: 'text', text: 'the parser' },
    ]
    expect(assistantText(content)).toBe('Build the parser')
  })

  test('passes a bare string through — some wires hand back a string, not the array', () => {
    expect(assistantText('Generated title')).toBe('Generated title')
    expect(assistantText('')).toBe('')
  })

  // ---- The regression this owner exists to prevent --------------------------------
  //
  // The non-array branch used to be `String(content)`, so a nullish reply became the
  // LITERAL 4-character string "null". Both consequences below are load-bearing.

  test('a nullish reply flattens to an EMPTY string, never the word "null"', () => {
    expect(assistantText(null)).toBe('')
    expect(assistantText(undefined)).toBe('')
    // The precise defect: `String(null)` is a non-empty, plausible-looking string.
    expect(assistantText(null)).not.toBe('null')
    expect(assistantText(undefined)).not.toBe('undefined')
  })

  test('an unusable reply is BLANK, so blank-guards downstream actually fire', () => {
    // `chat/runtime/context-compression.ts` keeps history unchanged when the
    // summarizer produced nothing usable — it tests `!text.trim()`. The string
    // "null" is truthy after trim, so the old owner walked straight past that guard
    // and would have replaced a compacted history block with the word "null".
    // Session titling has the same shape of guard before it persists a session NAME.
    for (const unusable of [null, undefined, [], [{ type: 'thinking', text: 'x' }]]) {
      const text = assistantText(unusable)
      expect(text).toBe('')
      expect(text.trim()).toBeFalsy()
    }
  })

  test('an empty block array and a text-block-free array both flatten to ""', () => {
    expect(assistantText([])).toBe('')
    expect(assistantText([{ type: 'image', text: 'x' }])).toBe('')
    expect(assistantText([{ type: 'text' }])).toBe('') // malformed: no `text` string
  })

  test('a novel non-nullish shape is JSON-encoded, not silently dropped', () => {
    // Last resort: a shape nobody anticipated should be VISIBLE in the output rather
    // than vanishing into `''`, which would be indistinguishable from "no reply".
    // JSON, not String(): this text becomes a commit message / summary, and
    // `[object Object]` carries none of the payload it was supposed to preserve.
    expect(assistantText(42)).toBe('42')
    expect(assistantText({ unexpected: true })).toBe('{"unexpected":true}')
  })
})
