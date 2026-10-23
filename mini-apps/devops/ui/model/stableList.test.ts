import { describe, expect, test } from 'bun:test'

import { rowsEqual, stableList } from './stableList'

describe('stableList', () => {
  test('keeps the previous array when a poll returned identical rows', () => {
    const previous = [{ id: 'a', state: 'running' }]
    const next = [{ id: 'a', state: 'running' }]
    expect(stableList(previous, next)).toBe(previous)
  })

  test('keeps unchanged row identities when one row changed', () => {
    const previous = [
      { id: 'a', state: 'running' },
      { id: 'b', state: 'running' },
    ]
    const next = [
      { id: 'a', state: 'running' },
      { id: 'b', state: 'exited' },
    ]
    const merged = stableList(previous, next)
    expect(merged).not.toBe(previous)
    expect(merged[0]).toBe(previous[0])
    expect(merged[1]).toBe(next[1])
  })

  test('a shorter or longer list is a change', () => {
    const previous = [{ id: 'a' }, { id: 'b' }]
    expect(stableList(previous, [{ id: 'a' }])).not.toBe(previous)
    expect(stableList(previous, [...previous, { id: 'c' }])).not.toBe(previous)
  })

  test('compares nested string arrays and objects one level deep', () => {
    expect(rowsEqual({ roles: ['a', 'b'] }, { roles: ['a', 'b'] })).toBe(true)
    expect(rowsEqual({ roles: ['a'] }, { roles: ['b'] })).toBe(false)
    expect(rowsEqual({ labels: { app: 'api' } }, { labels: { app: 'api' } })).toBe(true)
    expect(rowsEqual({ labels: { app: 'api' } }, { labels: { app: 'web' } })).toBe(false)
  })

  test('an unrepresentable value counts as changed rather than as equal', () => {
    const fn = () => {}
    expect(rowsEqual({ hook: fn }, { hook: () => {} })).toBe(false)
  })
})
