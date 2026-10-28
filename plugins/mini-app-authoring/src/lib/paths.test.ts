import { describe, expect, test } from 'bun:test'

import { isPathBelow, isPathWithin, resolveWithin } from './paths'

// The plugin cannot import @localixai/path-containment, so these pin its own copy to the same
// answers: the sibling trap, the filesystem root, an escape, and an unset root.
describe('lexical containment', () => {
  test('a sibling that shares the root as a prefix is outside it', () => {
    expect(isPathWithin('/a/log', '/a/logger/x')).toBe(false)
    expect(isPathWithin('/a/log', '/a/log/x')).toBe(true)
  })

  test('a name that starts with two dots is inside, a parent step is not', () => {
    expect(isPathWithin('/a', '/a/..hidden')).toBe(true)
    expect(isPathWithin('/a', '/a/../b')).toBe(false)
    expect(isPathWithin('/a/b', '/a')).toBe(false)
  })

  test('the filesystem root contains every absolute path', () => {
    expect(isPathWithin('/', '/etc/hosts')).toBe(true)
  })

  test('the root itself is within but not below', () => {
    expect(isPathWithin('/a', '/a/')).toBe(true)
    expect(isPathBelow('/a', '/a/')).toBe(false)
    expect(isPathBelow('/a', '/a/b')).toBe(true)
  })

  test('an empty root or candidate is never contained', () => {
    expect(isPathWithin('', '/a')).toBe(false)
    expect(isPathWithin('/a', '')).toBe(false)
  })

  test('resolveWithin returns the resolved path or null when the target leaves the root', () => {
    expect(resolveWithin('/a', 'b/c')).toBe('/a/b/c')
    expect(resolveWithin('/a', '../b')).toBeNull()
    expect(resolveWithin('/a', '/etc/hosts')).toBeNull()
  })
})
