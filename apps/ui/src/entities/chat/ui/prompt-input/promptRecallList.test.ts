import { describe, expect, test } from 'bun:test'
import { buildPromptRecallList } from './promptRecallList'

const user = (content: string, isInternal = false) => ({ role: 'user', content, isInternal })
const asst = (content: string) => ({ role: 'assistant', content })

describe('buildPromptRecallList', () => {
  test('no messages and no history yields an empty list', () => {
    expect(buildPromptRecallList([], [])).toEqual([])
  })

  test("extracts the session's user prompts oldest→newest", () => {
    expect(buildPromptRecallList([user('a'), asst('x'), user('b')], [])).toEqual(['a', 'b'])
  })

  test('skips internal + non-user + blank messages, and trims', () => {
    const msgs = [user('  hello  '), user('   '), asst('y'), user('secret', true), user('world')]
    expect(buildPromptRecallList(msgs, [])).toEqual(['hello', 'world'])
  })

  test('collapses an immediate repeat', () => {
    expect(buildPromptRecallList([user('a'), user('a'), user('b')], [])).toEqual(['a', 'b'])
  })

  test('a re-sent prompt floats to the newest slot (global de-dupe)', () => {
    // a, b, a → the repeated "a" appears once, at the newest position.
    expect(buildPromptRecallList([user('a'), user('b'), user('a')], [])).toEqual(['b', 'a'])
  })

  test('merges global history after the session, de-duped, oldest→newest', () => {
    // session newest-first [b,a] ++ global [c,a] → de-dupe → [b,a,c] → reverse.
    expect(buildPromptRecallList([user('a'), user('b')], ['c', 'a'])).toEqual(['c', 'a', 'b'])
  })
})
