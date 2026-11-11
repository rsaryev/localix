import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import {
  assertMarketplaceAllowed,
  assertPluginAllowed,
  managedDeclarations,
  marketplacePolicy,
} from './policy'

/**
 * The organization's marketplace policy in managed settings (`strictKnownMarketplaces`,
 * `blockedMarketplaces`, `enabledPlugins`, `extraKnownMarketplaces`), judged by the kit.
 */

const dir = tempDirPerTest('kit-market-policy-')
const CATALOG = '.claude-plugin/marketplace.json'
const github = (repo: string, more: { ref?: string } = {}) =>
  ({ kind: 'github', repo, path: CATALOG, ...more }) as const

const managed = (settings: Record<string, unknown>, more: Record<string, string> = {}) => {
  writeTree(join(dir(), 'managed'), {
    'managed-settings.json': JSON.stringify(settings),
    ...more,
  })
  return join(dir(), 'managed')
}

describe('managed marketplace policy', () => {
  it('blocks a listed repository and every repository of a blocked owner', async () => {
    const from = managed({
      blockedMarketplaces: [{ source: 'github', repo: 'evil/plugins' }],
    })
    await expect(assertMarketplaceAllowed(github('evil/plugins'), from)).rejects.toThrow(
      "Marketplace source 'github:evil/plugins' is blocked by enterprise policy",
    )
    await expect(assertMarketplaceAllowed(github('good/one'), from)).resolves.toBeUndefined()
  })

  it('admits only what strictKnownMarketplaces lists, by host or by path pattern', async () => {
    const from = managed({
      strictKnownMarketplaces: [
        { source: 'github', repo: 'acme/approved' },
        { source: 'hostPattern', hostPattern: '^git\\.example\\.com$' },
        { source: 'pathPattern', pathPattern: '^/opt/approved/' },
      ],
    })
    const gate = (await marketplacePolicy(from)).gate
    const allowed = (source: Parameters<typeof gate.check>[0]) => gate.check(source).allowed
    expect(allowed({ source: 'github', repo: 'acme/approved' })).toBe(true)
    expect(allowed({ source: 'git', url: 'https://git.example.com/a/b.git' })).toBe(true)
    expect(allowed({ source: 'directory', path: '/opt/approved/m' })).toBe(true)
    await expect(
      assertMarketplaceAllowed({ kind: 'directory', path: '/home/me/m' }, from),
    ).rejects.toThrow('is blocked by enterprise policy')
  })

  it('an empty allowlist admits no marketplace', async () => {
    const from = managed({ strictKnownMarketplaces: [] })
    await expect(assertMarketplaceAllowed(github('x/y'), from)).rejects.toThrow(
      'No external marketplaces are allowed.',
    )
  })

  it('refuses a plugin managed settings turn off, in the policy words', async () => {
    const from = managed(
      { enabledPlugins: { 'a@m': true } },
      { 'managed-settings.d/20-b.json': JSON.stringify({ enabledPlugins: { 'a@m': false } }) },
    )
    await expect(assertPluginAllowed('a@m', from)).rejects.toThrow(
      'Plugin "a@m" is blocked by your organization\'s policy and cannot be installed',
    )
    await expect(assertPluginAllowed('b@m', from)).resolves.toBeUndefined()
  })

  it('reads the marketplaces managed settings declare', async () => {
    const from = managed({
      extraKnownMarketplaces: { team: { source: { source: 'github', repo: 'acme/team' } } },
    })
    expect(Object.keys(await managedDeclarations(from))).toEqual(['team'])
  })
})
