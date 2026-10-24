import { describe, expect, it } from 'bun:test'
import { join } from 'node:path'

import { tempDirPerTest, writeTree } from '@localixai/testing'

import { marketplacePolicyProblem, readManagedPolicy } from './claude-code-policy'
import { addMarketplace } from './marketplace-registry'

/**
 * Managed settings, the organization's policy (settings-reference.md `strictKnownMarketplaces`,
 * `blockedMarketplaces`; managed-settings.md, "Split a file-based policy across teams"): which
 * marketplace sources may be added and installed from.
 */

const dir = tempDirPerTest('cc-policy-')

describe('managed marketplace policy', () => {
  it('merges managed-settings.json, then managed-settings.d/*.json alphabetically', async () => {
    writeTree(join(dir(), 'managed'), {
      'managed-settings.json': JSON.stringify({
        blockedMarketplaces: [{ source: 'github', repo: 'evil/one' }],
        enabledPlugins: { 'a@m': true },
      }),
      'managed-settings.d/20-b.json': JSON.stringify({ enabledPlugins: { 'a@m': false } }),
      'managed-settings.d/10-a.json': JSON.stringify({
        blockedMarketplaces: [{ source: 'github', repo: 'evil/two' }],
      }),
      'managed-settings.d/.hidden.json': JSON.stringify({ enabledPlugins: { 'a@m': true } }),
    })
    const policy = await readManagedPolicy(join(dir(), 'managed'))
    expect(policy.enabledPlugins).toEqual({ 'a@m': false })
    expect(policy.blockedMarketplaces).toHaveLength(2)
  })

  it('blocks a listed repository in any spelling, and owner wildcards', () => {
    const policy = {
      enabledPlugins: {},
      blockedMarketplaces: [
        { source: 'github', repo: 'Evil/Plugins' },
        { source: 'github', repo: 'bad-org/*' },
      ],
    }
    expect(
      marketplacePolicyProblem(
        { source: 'git', url: 'https://github.com/evil/plugins.git' },
        policy,
      ),
    ).toContain('blockedMarketplaces')
    expect(
      marketplacePolicyProblem({ source: 'github', repo: 'bad-org/anything' }, policy),
    ).toContain('blockedMarketplaces')
    expect(marketplacePolicyProblem({ source: 'github', repo: 'good/one' }, policy)).toBeUndefined()
  })

  it('allows only what strictKnownMarketplaces lists, exactly, by pattern or by owner', () => {
    const policy = {
      enabledPlugins: {},
      blockedMarketplaces: [],
      strictKnownMarketplaces: [
        { source: 'github', repo: 'acme/approved' },
        { source: 'github', repo: 'tools/*' },
        { source: 'hostPattern', hostPattern: '^git\\.example\\.com$' },
        { source: 'pathPattern', pathPattern: '^/opt/approved/' },
      ],
    }
    const allowed = (source: Parameters<typeof marketplacePolicyProblem>[0]) =>
      marketplacePolicyProblem(source, policy) === undefined
    expect(allowed({ source: 'github', repo: 'acme/approved' })).toBe(true)
    expect(allowed({ source: 'github', repo: 'acme/approved', ref: 'main' })).toBe(false)
    expect(allowed({ source: 'github', repo: 'tools/x' })).toBe(true)
    expect(allowed({ source: 'git', url: 'https://git.example.com/a/b.git' })).toBe(true)
    expect(allowed({ source: 'local', path: '/opt/approved/m' })).toBe(true)
    expect(allowed({ source: 'local', path: '/home/me/m' })).toBe(false)
    expect(
      marketplacePolicyProblem(
        { source: 'github', repo: 'x/y' },
        { ...policy, strictKnownMarketplaces: [] },
      ),
    ).toContain('strictKnownMarketplaces')
  })

  it('refuses to add a blocked marketplace before fetching anything', async () => {
    writeTree(join(dir(), 'managed'), {
      'managed-settings.json': JSON.stringify({
        blockedMarketplaces: [{ source: 'github', repo: 'evil/plugins' }],
      }),
    })
    let cloned = false
    await expect(
      addMarketplace(
        { source: 'github', repo: 'evil/plugins' },
        {
          root: join(dir(), 'marketplaces'),
          managedSettingsDir: join(dir(), 'managed'),
          cloneRepo: async () => {
            cloned = true
          },
        },
      ),
    ).rejects.toThrow(/managed settings/)
    expect(cloned).toBe(false)
  })
})
