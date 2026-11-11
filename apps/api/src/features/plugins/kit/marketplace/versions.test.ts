import { describe, expect, test } from 'bun:test'

import { pluginVersion } from './versions'

/**
 * The version as the kit computes it (`resolvePluginVersion`, its rules tested in the kit), over
 * Localix's sha256 port.
 */

const SHA = '0123456789abcdef0123456789abcdef01234567'
const BASE = { inGitRepository: false, enclosingRepoIgnored: false } as const

describe('pluginVersion', () => {
  test('a git-subdir version carries a hash of the subdirectory path, from the sha256 port', async () => {
    const at = (subdir: string) =>
      pluginVersion({ ...BASE, sourceKind: 'git-subdir', subdir, commitSha: SHA })
    const one = await at('plugins/a')
    expect(one.startsWith('0123456789ab-')).toBe(true)
    expect(one).not.toBe(await at('plugins/b'))
  })

  test('the manifest version comes first; nothing known is unknown', async () => {
    expect(await pluginVersion({ ...BASE, sourceKind: 'npm', manifestVersion: '2.0.0' })).toBe(
      '2.0.0',
    )
    expect(await pluginVersion({ ...BASE, sourceKind: 'npm' })).toBe('unknown')
  })
})
