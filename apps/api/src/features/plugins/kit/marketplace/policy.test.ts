import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { assertMarketplaceAllowed, assertPluginAllowed, managedDeclarations } from './policy'

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
