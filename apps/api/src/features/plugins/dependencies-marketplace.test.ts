/**
 * A dependency that names its marketplace (dependencies.md, "Declare a dependency with a version
 * constraint" and "Depend on a plugin from another marketplace"): `"name@marketplace"` or
 * `{ name, marketplace }` resolves in that marketplace, still under the root's allowlist.
 */
import { describe, expect, it } from 'bun:test'

import { isApiError } from '../../lib/errors'
import {
  normalizePluginDependencies,
  resolveDependencyPlan,
  type DependencyResolverDeps,
  type ResolvedDependencyStep,
} from './dependencies'
import { fromClaudePlugin } from './layout/claude-code'

const step = (name: string, marketplace: string): ResolvedDependencyStep => ({
  name,
  marketplace,
  dir: `/mkt/${marketplace}/${name}`,
  entry: { name, source: `./${name}` },
  dependencies: [],
})

function resolver(
  markets: Record<string, string[]>,
  allow: Record<string, string[]> = {},
): DependencyResolverDeps {
  return {
    installed: new Map(),
    findMarketplacesWithPlugin: async (name) =>
      Object.keys(markets).filter((m) => markets[m]!.includes(name)),
    resolveFromMarketplace: async (name, marketplace) => step(name, marketplace),
    getAllowList: async (marketplace) => allow[marketplace] ?? [],
  }
}

/** The dependencies a plugin.json declares, as the runtime manifest carries them. */
const declared = (dependencies: unknown[]) =>
  normalizePluginDependencies(
    fromClaudePlugin({ name: 'deploy-kit', dependencies } as never, []).dependencies,
  )

describe('a dependency that names its marketplace', () => {
  it('reads "name@marketplace" and { name, marketplace } from plugin.json', () => {
    expect(
      declared([
        'audit-logger@shared',
        { name: 'secrets-vault', marketplace: 'shared', version: '~2.1.0' },
        'plain',
      ]),
    ).toEqual([
      { name: 'audit-logger', marketplace: 'shared' },
      { name: 'secrets-vault', marketplace: 'shared', version: '~2.1.0' },
      { name: 'plain' },
    ])
  })

  it('installs from the named marketplace when the root allows it', async () => {
    const plan = await resolveDependencyPlan(
      [{ name: 'audit-logger', marketplace: 'shared' }],
      'main',
      resolver({ main: ['audit-logger'], shared: ['audit-logger'] }, { main: ['shared'] }),
    )
    expect(plan.steps.map((s) => s.marketplace)).toEqual(['shared'])
  })

  it('is refused when the root marketplace does not allow the named one', async () => {
    const error = await resolveDependencyPlan(
      [{ name: 'audit-logger', marketplace: 'shared' }],
      'main',
      resolver({ main: ['audit-logger'], shared: ['audit-logger'] }),
    ).catch((e: unknown) => e)
    expect(isApiError(error) && error.code).toBe('plugin_dependency_blocked')
    expect((error as Error).message).toContain('audit-logger@shared')
  })

  it('is missing when the named marketplace does not list it', async () => {
    const error = await resolveDependencyPlan(
      [{ name: 'audit-logger', marketplace: 'shared' }],
      'main',
      resolver({ main: ['audit-logger'], shared: [] }, { main: ['shared'] }),
    ).catch((e: unknown) => e)
    expect(isApiError(error) && error.code).toBe('plugin_dependency_missing')
  })
})
