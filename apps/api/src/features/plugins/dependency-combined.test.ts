/**
 * Several plugins constraining one dependency (dependencies.md, "Combine constraints from several
 * plugins"): the dependency resolves to the highest version every range admits, and ranges that
 * share no version fail the install with `has conflicting version requirements`, leaving what is
 * installed as it was.
 */
import { describe, expect, it } from 'bun:test'

import {
  resolveDependencyPlan,
  type DependencyResolverDeps,
  type ResolvedDependencyStep,
} from './dependencies'

const TAGS = ['2.0.0', '2.1.0', '2.4.0', '3.0.0', '3.1.0']

/** One marketplace `m` offering `vault` at every tag; a step records the range it resolved. */
function resolver(opts: {
  installed?: Map<string, string | undefined>
  constraints?: Map<string, Array<{ range: string; by: string }>>
}): DependencyResolverDeps & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    installed: opts.installed ?? new Map(),
    ...(opts.constraints ? { constraints: opts.constraints } : {}),
    findMarketplacesWithPlugin: async () => ['m'],
    getAllowList: async () => [],
    versionsOf: async () => TAGS,
    resolveFromMarketplace: async (name, marketplace, range) => {
      asked.push(range ?? '')
      const version = TAGS.filter((tag) => !range || Bun.semver.satisfies(tag, range))
        .sort(Bun.semver.order)
        .at(-1)
      return {
        name,
        marketplace,
        dir: `/m/${name}`,
        entry: { name, source: `./${name}` },
        dependencies: [],
        ...(version ? { version } : {}),
      } satisfies ResolvedDependencyStep
    },
  }
}

describe('a dependency several plugins constrain', () => {
  it('installs the highest version every range admits', async () => {
    const deps = resolver({ constraints: new Map([['vault', [{ range: '^2.0', by: 'app-a' }]]]) })
    const plan = await resolveDependencyPlan([{ name: 'vault', version: '>=2.1' }], 'm', deps)
    expect(plan.steps.map((s) => s.version)).toEqual(['2.4.0'])
  })

  it('moves an installed dependency to a version both ranges admit', async () => {
    const deps = resolver({
      installed: new Map([['vault', '2.0.0']]),
      constraints: new Map([['vault', [{ range: '^2.0', by: 'app-a' }]]]),
    })
    const plan = await resolveDependencyPlan([{ name: 'vault', version: '>=2.1' }], 'm', deps)
    expect(plan.steps.map((s) => [s.name, s.version])).toEqual([['vault', '2.4.0']])
  })

  it('refuses ranges that share no version, naming the plugins', async () => {
    const deps = resolver({
      installed: new Map([['vault', '2.1.0']]),
      constraints: new Map([['vault', [{ range: '~2.1', by: 'app-a' }]]]),
    })
    const error = await resolveDependencyPlan(
      [{ name: 'vault', version: '~3.0' }],
      'm',
      deps,
    ).catch((err: Error) => err)
    const message = error instanceof Error ? error.message : ''
    expect(message).toContain('"vault" has conflicting version requirements')
    expect(message).toContain('~2.1 (app-a)')
    expect(deps.asked).toEqual([])
  })
})
