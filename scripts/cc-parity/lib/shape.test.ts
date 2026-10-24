import { expect, test } from 'bun:test'

import { describe, mergeShape } from '../probe/hooks/shape.js'

test('a descriptor keeps keys and kinds, never a value', () => {
  const shape = describe({
    text: 'private words',
    usage: { input_tokens: 12 },
    tags: ['a', 'b'],
    none: null,
    empty: [],
  })
  expect(shape).toEqual({
    empty: [],
    none: 'null',
    tags: ['string'],
    text: 'string',
    usage: { input_tokens: 'number' },
  })
  expect(JSON.stringify(shape)).not.toContain('private')
})

test('past its depth an object is only an object, so keys that are data stay out', () => {
  expect(describe({ settings: { 'projects/notes.md': true } }, 1)).toEqual({ settings: 'object' })
  expect(describe({ list: [{ a: 1 }] }, 1)).toEqual({ list: 'array' })
})

test('merged observations keep every key, marking the ones only some had', () => {
  const answered = describe({ isAnswered: true, text: 'hi' })
  const unanswered = describe({ isAnswered: false, reason: 'nothing-to-fork' })
  expect(mergeShape(answered, unanswered)).toEqual({
    isAnswered: 'boolean',
    'reason?': 'string',
    'text?': 'string',
  })
  expect(mergeShape('string', 'null')).toEqual({ $oneOf: ['null', 'string'] })
  expect(mergeShape(mergeShape('string', { a: 'number' }), { b: 'string' })).toEqual({
    $oneOf: ['string', { 'a?': 'number', 'b?': 'string' }],
  })
  expect(mergeShape([], ['number'])).toEqual(['number'])
})
