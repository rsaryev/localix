import { describe, expect, test } from 'bun:test'
import type { FileChange } from '@localixai/agent/agents'

import { lastContent, lastNewString, sumDiffStats } from './fileChangeFormat'

const change = (diff?: string): FileChange => ({ diff }) as unknown as FileChange

describe('sumDiffStats', () => {
  test('sums +/- across changes, counting diff lines', () => {
    // countPatchChanges counts leading +/- (excluding ++/-- headers).
    expect(sumDiffStats([change('+a\n+b\n-c'), change('+d\n-e\n-f')])).toEqual({
      additions: 3,
      deletions: 3,
    })
  })
  test('skips changes without a diff', () => {
    expect(sumDiffStats([change(undefined), change('+x')])).toEqual({ additions: 1, deletions: 0 })
  })
  test('empty list → zeroes', () => {
    expect(sumDiffStats([])).toEqual({ additions: 0, deletions: 0 })
  })
})

describe('lastContent', () => {
  test('returns the content of the last file being typed in a batched write', () => {
    expect(
      lastContent([
        { path: 'a', content: 'one' },
        { path: 'b', content: 'two' },
      ]),
    ).toBe('two')
    // The last entry has only streamed its path so far: the previous body is still the live one.
    expect(lastContent([{ path: 'a', content: 'one' }, { path: 'b' }])).toBe('one')
  })
  test('non-array / no content → undefined', () => {
    expect(lastContent(undefined)).toBeUndefined()
    expect(lastContent([{ path: 'a' }, null])).toBeUndefined()
  })
})

describe('lastNewString', () => {
  test('returns the last non-empty new_string', () => {
    expect(lastNewString([{ new_string: 'a' }, { new_string: 'b' }])).toBe('b')
  })
  test('skips empty / non-string / malformed entries, scanning backwards', () => {
    expect(lastNewString([{ new_string: 'keep' }, { new_string: '' }, null, { other: 1 }])).toBe(
      'keep',
    )
  })
  test('non-array / no match → undefined', () => {
    expect(lastNewString(undefined)).toBeUndefined()
    expect(lastNewString('nope')).toBeUndefined()
    expect(lastNewString([{ new_string: '' }, {}])).toBeUndefined()
  })
})
