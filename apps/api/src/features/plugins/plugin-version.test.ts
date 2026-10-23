import { describe, expect, test } from 'bun:test'

import { entryVersionFacts, resolvePluginVersion } from './plugin-version'

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('the version Claude Code computes for a plugin', () => {
  test('the manifest version comes first, then the marketplace entry version', () => {
    expect(
      resolvePluginVersion({
        manifestVersion: '2.0.0',
        entryVersion: '1.0.0',
        source: { kind: 'git', commitSha: SHA },
      }),
    ).toBe('2.0.0')
    expect(
      resolvePluginVersion({ entryVersion: '1.0.0', source: { kind: 'git', commitSha: SHA } }),
    ).toBe('1.0.0')
  })

  test('without a version field, a git source is its commit shortened to 12 characters', () => {
    expect(resolvePluginVersion({ source: { kind: 'git', commitSha: SHA } })).toBe('0123456789ab')
  })

  test('a git-subdir version also carries a hash of the subdirectory path', () => {
    const one = resolvePluginVersion({
      source: { kind: 'git', commitSha: SHA, subdir: 'plugins/a' },
    })
    const other = resolvePluginVersion({
      source: { kind: 'git', commitSha: SHA, subdir: 'plugins/b' },
    })
    expect(one.startsWith('0123456789ab-')).toBe(true)
    expect(one).not.toBe(other)
  })

  test('an archive is its sha256 digest shortened to 12 characters', () => {
    expect(
      resolvePluginVersion({ source: { kind: 'archive', sha256: 'ABCDEF' + '0'.repeat(58) } }),
    ).toBe('abcdef000000')
  })

  test('a relative path in a git-hosted marketplace is the marketplace commit', () => {
    expect(resolvePluginVersion({ source: { kind: 'relative', commitSha: SHA } })).toBe(
      '0123456789ab',
    )
  })

  test('a local directory, an npm package and anything without a commit are unknown', () => {
    expect(resolvePluginVersion({ source: { kind: 'relative' } })).toBe('unknown')
    expect(resolvePluginVersion({ source: { kind: 'npm' } })).toBe('unknown')
    expect(resolvePluginVersion({ source: { kind: 'git' } })).toBe('unknown')
    expect(resolvePluginVersion({ source: { kind: 'archive' } })).toBe('unknown')
  })

  test('a version that is not one path segment is made into one', () => {
    expect(resolvePluginVersion({ manifestVersion: '1.0/../x', source: { kind: 'npm' } })).toBe(
      '1.0-..-x',
    )
    expect(resolvePluginVersion({ manifestVersion: '..', source: { kind: 'npm' } })).toBe('unknown')
  })
})

describe('what a marketplace entry says about its version before anything is fetched', () => {
  test('a pinned sha is the version source and never moves', () => {
    expect(
      entryVersionFacts({ name: 'p', source: { source: 'github', repo: 'o/r', sha: SHA } }),
    ).toEqual({ kind: 'git', commitSha: SHA, pinned: true })
  })

  test('a relative entry, an npm entry and an archive entry', () => {
    expect(entryVersionFacts({ name: 'p', source: './plugins/p' })).toEqual({ kind: 'relative' })
    expect(entryVersionFacts({ name: 'p', source: { source: 'npm', package: 'x' } })).toEqual({
      kind: 'npm',
    })
    expect(
      entryVersionFacts({
        name: 'p',
        source: { source: 'archive', url: 'https://x', sha256: 'ab' },
      }),
    ).toEqual({ kind: 'archive', sha256: 'ab' })
  })

  test('an unpinned git entry is a git source whose commit is not known yet', () => {
    expect(
      entryVersionFacts({ name: 'p', source: { source: 'git-subdir', url: 'o/r', path: 'x' } }),
    ).toEqual({ kind: 'git', subdir: 'x' })
  })
})
