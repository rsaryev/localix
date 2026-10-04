import { describe, expect, test } from 'bun:test'

import { plural, pluralize } from './plural'

describe('plural', () => {
  test('singular only at exactly 1', () => {
    expect(plural(1, 'file')).toBe('1 file')
    expect(plural(0, 'file')).toBe('0 files')
    expect(plural(2, 'file')).toBe('2 files')
  })

  test('the noun may be a phrase', () => {
    expect(plural(1, 'changed file')).toBe('1 changed file')
    expect(plural(3, 'chat session')).toBe('3 chat sessions')
  })

  test('matches the `${n} x${n === 1 ? "" : "s"}` idiom it replaced, for every count', () => {
    for (const n of [0, 1, 2, 3, 10, 100]) {
      expect(plural(n, 'thing')).toBe(`${n} thing${n === 1 ? '' : 's'}`)
    }
  })
})

describe('pluralize', () => {
  test('suffixes the noun without the count', () => {
    expect(pluralize('task', 1)).toBe('task')
    expect(pluralize('task', 0)).toBe('tasks')
    expect(pluralize('task', 2)).toBe('tasks')
  })
})
