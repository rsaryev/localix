import { describe, expect, test } from 'bun:test'

import { createFileContentCache } from './fileContentCache'
import type { FileContentResponse } from '@/shared/api/contracts'

const response = (
  path: string,
  content = path,
  overrides: Partial<FileContentResponse> = {},
): FileContentResponse => ({
  path,
  content,
  bytes: content.length,
  truncated: false,
  hash: `hash:${content}`,
  ...overrides,
})

describe('file content cache', () => {
  test('serves a complete text snapshot and refreshes its LRU position', () => {
    const cache = createFileContentCache(2, 10_000)
    cache.put('s', 'a.ts', response('/repo/a.ts', 'a'))
    cache.put('s', 'b.ts', response('/repo/b.ts', 'b'))

    expect(cache.get('s', 'a.ts')?.content).toBe('a')
    cache.put('s', 'c.ts', response('/repo/c.ts', 'c'))

    expect(cache.get('s', 'a.ts')).toBeDefined()
    expect(cache.get('s', 'b.ts')).toBeUndefined()
  })

  test('bounds retained heap by approximate bytes as well as entry count', () => {
    const oneWeight = 'x'.repeat(100).length * 2 + '/repo/a.ts'.length * 2 + 256
    const cache = createFileContentCache(10, oneWeight + 10)
    cache.put('s', 'a.ts', response('/repo/a.ts', 'x'.repeat(100)))
    cache.put('s', 'b.ts', response('/repo/b.ts', 'y'.repeat(100)))

    expect(cache.size).toBe(1)
    expect(cache.get('s', 'a.ts')).toBeUndefined()
    expect(cache.get('s', 'b.ts')).toBeDefined()
    expect(cache.bytes).toBeLessThanOrEqual(oneWeight + 10)
  })

  test('refuses truncated, binary and unversioned responses', () => {
    const cache = createFileContentCache()

    expect(cache.put('s', 'truncated', response('/t', 'x', { truncated: true }))).toBe(false)
    expect(cache.put('s', 'binary', response('/b', 'AA==', { encoding: 'base64' }))).toBe(false)
    expect(cache.put('s', 'unversioned', response('/u', 'x', { hash: undefined }))).toBe(false)
    expect(cache.size).toBe(0)
  })

  test('invalidates exact file writes and coarse or directory fs frames', () => {
    const cache = createFileContentCache()
    cache.put('a', 'one.ts', response('/repo/src/one.ts'))
    cache.put('a', 'two.ts', response('/repo/test/two.ts'))
    cache.put('b', 'one.ts', response('/repo/src/one.ts'))

    cache.invalidateFiles(new Set(['/repo/test/two.ts']))
    expect(cache.get('a', 'two.ts')).toBeUndefined()

    cache.invalidateDirectories('a', ['/repo/src'])
    expect(cache.get('a', 'one.ts')).toBeUndefined()
    expect(cache.get('b', 'one.ts')).toBeDefined()

    cache.invalidateDirectories('b', [])
    expect(cache.size).toBe(0)
  })
})
