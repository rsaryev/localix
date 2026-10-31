import { describe, expect, test } from 'bun:test'
import {
  buildMessageSearchIndex,
  matchingIndexedIds,
  type SearchableMessage,
} from './messageSearch'

const search = (messages: SearchableMessage[], query: string) =>
  matchingIndexedIds(buildMessageSearchIndex(messages), query)

const m = (o: Partial<SearchableMessage> & { id: string }): SearchableMessage => ({
  role: 'user',
  ...o,
})

describe('searching the transcript', () => {
  test('case-insensitive substring over content, preserving order', () => {
    const msgs = [
      m({ id: '1', content: 'Hello World' }),
      m({ id: '2', content: 'nope' }),
      m({ id: '3', content: 'a world tour' }),
    ]
    expect(search(msgs, 'world')).toEqual(['1', '3'])
    expect(search(msgs, 'WORLD')).toEqual(['1', '3'])
  })

  test('blank / whitespace query → no matches', () => {
    expect(search([m({ id: '1', content: 'x' })], '   ')).toEqual([])
    expect(search([m({ id: '1', content: 'x' })], '')).toEqual([])
  })

  test('skips system / internal / ui-only rows and missing content', () => {
    const msgs = [
      m({ id: 'sys', role: 'system', content: 'find' }),
      m({ id: 'int', content: 'find', isInternal: true }),
      m({ id: 'ui', content: 'find', uiOnly: true }),
      m({ id: 'none' }),
      m({ id: 'ok', content: 'find me' }),
    ]
    expect(search(msgs, 'find')).toEqual(['ok'])
  })
})

describe('prebuilt search index', () => {
  test('lowercases once, at index time, and matches any case', () => {
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
    expect(matchingIndexedIds(index, 'WORLD')).toEqual(['1', '3'])
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
