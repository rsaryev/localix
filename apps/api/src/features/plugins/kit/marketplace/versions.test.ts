import { describe, expect, test } from 'bun:test'

import { pluginVersion } from './versions'

/**
 * The version of a plugin as the kit computes it (`resolvePluginVersion`; plugins/loading.md, "How
 * Claude Code computes the version"), from what Localix knows about its source.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567'

describe('pluginVersion', () => {
  test('the manifest version comes first, then the marketplace entry version', async () => {
    const source = { kind: 'git', commitSha: SHA } as const
    expect(await pluginVersion({ manifestVersion: '2.0.0', entryVersion: '1.0.0', source })).toBe(
      '2.0.0',
    )
    expect(await pluginVersion({ entryVersion: '1.0.0', source })).toBe('1.0.0')
  })

  test('without a version field, a git source is its commit shortened to 12 characters', async () => {
    expect(await pluginVersion({ source: { kind: 'git', commitSha: SHA } })).toBe('0123456789ab')
  })

  test('a git-subdir version also carries a hash of the subdirectory path', async () => {
    const one = await pluginVersion({
      source: { kind: 'git', commitSha: SHA, subdir: 'plugins/a' },
    })
    const other = await pluginVersion({
      source: { kind: 'git', commitSha: SHA, subdir: 'plugins/b' },
    })
    expect(one.startsWith('0123456789ab-')).toBe(true)
    expect(one).not.toBe(other)
  })

  test('an archive is its sha256 digest shortened to 12 characters', async () => {
    const sha256 = 'ABCDEF' + '0'.repeat(58)
    expect(await pluginVersion({ source: { kind: 'archive', sha256 } })).toBe('abcdef000000')
  })

  test('a relative path in a git-hosted marketplace is the marketplace commit', async () => {
    expect(await pluginVersion({ source: { kind: 'relative', commitSha: SHA } })).toBe(
      '0123456789ab',
    )
  })

  test('a local directory, an npm package and anything without a commit are unknown', async () => {
    for (const source of [
      { kind: 'relative' },
      { kind: 'npm' },
      { kind: 'git' },
      { kind: 'archive' },
    ] as const)
      expect(await pluginVersion({ source })).toBe('unknown')
  })

  test('a command source ignores the entry version and is unknown without the hash of its output', async () => {
    expect(await pluginVersion({ entryVersion: '1.0.0', source: { kind: 'command' } })).toBe(
      'unknown',
    )
  })

  test('a version that cannot name one folder is skipped, as if unset', async () => {
    const source = { kind: 'git', commitSha: SHA } as const
    expect(await pluginVersion({ manifestVersion: '1.0/../x', source })).toBe('0123456789ab')
    expect(await pluginVersion({ manifestVersion: '..', source: { kind: 'npm' } })).toBe('unknown')
  })
})
