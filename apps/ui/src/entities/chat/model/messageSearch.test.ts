import { describe, expect, test } from 'bun:test'
import {
  buildMessageSearchIndex,
  matchingIndexedIds,
  matchingMessageIds,
  type SearchableMessage,
} from './messageSearch'

const m = (o: Partial<SearchableMessage> & { id: string }): SearchableMessage => ({
  role: 'user',
  ...o,
})

describe('matchingMessageIds', () => {
  test('case-insensitive substring over content, preserving order', () => {
    const msgs = [
      m({ id: '1', content: 'Hello World' }),
      m({ id: '2', content: 'nope' }),
      m({ id: '3', content: 'a world tour' }),
    ]
    expect(matchingMessageIds(msgs, 'world')).toEqual(['1', '3'])
    expect(matchingMessageIds(msgs, 'WORLD')).toEqual(['1', '3'])
  })

  test('blank / whitespace query → no matches', () => {
    expect(matchingMessageIds([m({ id: '1', content: 'x' })], '   ')).toEqual([])
    expect(matchingMessageIds([m({ id: '1', content: 'x' })], '')).toEqual([])
  })

  test('skips system / internal / ui-only rows and missing content', () => {
    const msgs = [
      m({ id: 'sys', role: 'system', content: 'find' }),
      m({ id: 'int', content: 'find', isInternal: true }),
      m({ id: 'ui', content: 'find', uiOnly: true }),
      m({ id: 'none' }),
      m({ id: 'ok', content: 'find me' }),
    ]
    expect(matchingMessageIds(msgs, 'find')).toEqual(['ok'])
  })
})

describe('prebuilt search index', () => {
  test('lowercases once and matches the same ids as the direct scan', () => {
    const msgs = [
      m({ id: '1', content: 'Hello World' }),
      m({ id: 'sys', role: 'system', content: 'World' }),
      m({ id: '3', content: 'a WORLD tour' }),
    ]
    const index = buildMessageSearchIndex(msgs)

    // The costly `toLowerCase()` happened once, at index time.
    expect(index).toEqual([
      { id: '1', haystack: 'hello world' },
      { id: '3', haystack: 'a world tour' },
    ])
    expect(matchingIndexedIds(index, 'WORLD')).toEqual(matchingMessageIds(msgs, 'WORLD'))
    expect(matchingIndexedIds(index, 'world')).toEqual(['1', '3'])
    expect(matchingIndexedIds(index, '  ')).toEqual([])
  })

  test('index rebuild is only needed when the message list changes', () => {
    const msgs = [m({ id: '1', content: 'alpha beta' })]
    const index = buildMessageSearchIndex(msgs)
    // Successive keystrokes reuse the SAME index — this is the per-keystroke path.
    expect(matchingIndexedIds(index, 'a')).toEqual(['1'])
    expect(matchingIndexedIds(index, 'al')).toEqual(['1'])
    expect(matchingIndexedIds(index, 'alp')).toEqual(['1'])
    expect(matchingIndexedIds(index, 'alpz')).toEqual([])
  })
})
