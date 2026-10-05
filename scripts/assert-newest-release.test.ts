import { describe, expect, test } from 'bun:test'
import { assertNewestRelease, compareReleaseTags } from './assert-newest-release.mjs'

describe('compareReleaseTags', () => {
  test('orders versions by semantic-version precedence, pre-release labels included', () => {
    expect(compareReleaseTags('v0.1.0-beta.2', 'v0.1.0-beta.1')).toBe(1)
    expect(compareReleaseTags('v0.1.0-beta.10', 'v0.1.0-beta.9')).toBe(1)
    expect(compareReleaseTags('v0.1.0', 'v0.1.0-beta.9')).toBe(1)
    expect(compareReleaseTags('v0.1.0-beta.1', 'v0.1.0')).toBe(-1)
    expect(compareReleaseTags('v0.2.0-beta.1', 'v0.1.9')).toBe(1)
    expect(compareReleaseTags('v1.0.0', 'v1.0.0')).toBe(0)
  })

  test('ignores build metadata', () => {
    expect(compareReleaseTags('v1.0.0+abc', 'v1.0.0+def')).toBe(0)
  })
})

describe('assertNewestRelease', () => {
  test('accepts a first release and a newer one', () => {
    expect(assertNewestRelease({ tag: 'v0.1.0-beta.1', currentLatestTag: '' })).toBe(
      'first release',
    )
    expect(assertNewestRelease({ tag: 'v0.1.0-beta.1', currentLatestTag: undefined })).toBe(
      'first release',
    )
    expect(assertNewestRelease({ tag: 'v0.1.0-beta.2', currentLatestTag: 'v0.1.0-beta.1' })).toBe(
      'newer',
    )
  })

  test('accepts the same tag, so a re-run does not block itself', () => {
    expect(assertNewestRelease({ tag: 'v0.1.0-beta.1', currentLatestTag: 'v0.1.0-beta.1' })).toBe(
      'same tag',
    )
  })

  test('refuses an older version, naming both', () => {
    expect(() =>
      assertNewestRelease({ tag: 'v0.1.0-beta.1', currentLatestTag: 'v0.1.0-beta.2' }),
    ).toThrow(/v0\.1\.0-beta\.1 is older than the current latest release v0\.1\.0-beta\.2/u)
    expect(() => assertNewestRelease({ tag: 'v0.1.0-beta.5', currentLatestTag: 'v0.1.0' })).toThrow(
      'is older than',
    )
  })

  test('refuses an empty tag', () => {
    expect(() => assertNewestRelease({ tag: '', currentLatestTag: 'v0.1.0' })).toThrow('empty')
  })
})
