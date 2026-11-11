import { describe, expect, test } from 'bun:test'
import type { ScopeAgent, ScopeAgents } from '../../plugins/kit'
import { testCatalogAgent } from '../../plugins/kit/testing'
import { composeCatalog, type ScopeCatalog } from './compose'

const BUILTIN = { source: { kind: 'builtin' } } as const
/** A built-in as the kit lists one: no file, so no prompt of its own. */
function builtin(name: string): ScopeAgent {
  const agent = testCatalogAgent(name, {}, BUILTIN)
  return { ...agent, definition: { ...agent.definition, prompt: '' } }
}
const plugin = (name: string, scope: 'user' | 'project'): Partial<ScopeAgent> => ({
  source: { kind: 'plugin', pluginId: `${name}@x` },
  plugin: { name, scope },
})

/** The kit's answer for a scope, with a lookup by exact name. */
function scope(
  agents: ScopeAgent[],
  extra: Partial<ScopeCatalog> = {},
  shadowed: ScopeAgents['shadowed'] = [],
): ScopeCatalog {
  return {
    agents: {
      agents,
      shadowed,
      issues: [],
      watch: [],
      resolve: (reference) => {
        const found = agents.find((one) => one.name === reference)
        return found ? { agent: found } : null
      },
      main: null,
    },
    plugins: [],
    projectReadable: true,
    ...extra,
  }
}

describe("a scope's catalog with Localix's additions", () => {
  test('a project file and a project install belong to the project; the rest to no project', () => {
    const catalog = composeCatalog(
      scope([
        testCatalogAgent('mine', {}, { source: { kind: 'folder', scope: 'project' } }),
        testCatalogAgent('home'),
        testCatalogAgent('lab:own', {}, plugin('lab', 'project')),
        testCatalogAgent('acme:lead', {}, plugin('acme', 'user')),
      ]),
      'p',
    )
    expect(catalog.found.map((one) => [one.name, one.projectId])).toEqual([
      ['mine', 'p'],
      ['home', ''],
      ['lab:own', 'p'],
      ['acme:lead', ''],
    ])
    expect(catalog.found.every((one) => one.bodyHash.length === 16)).toBe(true)
  })

  test("the built-ins run on Localix's prompts; general-purpose is the delegator; localix is added", () => {
    const catalog = composeCatalog(scope([builtin('Explore'), builtin('general-purpose')]), '')
    const shown = catalog.builtins.map((one) => [
      one.name,
      Boolean(one.definition.prompt),
      one.self,
    ])
    expect(shown).toEqual([
      ['Explore', true, undefined],
      ['general-purpose', false, true],
      ['localix', true, undefined],
    ])
    expect(catalog.resolve('localix')).toMatchObject({ agent: BUILTIN })
  })

  test('a file named localix takes the main agent’s name; a shadowed definition names its winner', () => {
    const managed = { source: { kind: 'folder', scope: 'managed' } } as const
    const lost = testCatalogAgent('helper', { description: 'mine' })
    const winner = testCatalogAgent('helper', { description: 'org' }, managed)
    const catalog = composeCatalog(
      scope([testCatalogAgent('localix'), winner], {}, [{ agent: lost, by: winner }]),
      '',
    )
    const user = { kind: 'folder', scope: 'user' } as const
    const main = catalog.builtins.find((one) => one.name === 'localix')!
    expect(catalog.shadowedBy(main)?.source).toEqual(user)
    const shadowed = catalog.found.find((one) => one.definition.description === 'mine')!
    expect(catalog.shadowedBy(shadowed)?.definition.description).toBe('org')
    expect(catalog.resolve('localix')).toMatchObject({ agent: { source: user } })
  })
})
