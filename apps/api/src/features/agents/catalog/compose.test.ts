import { describe, expect, test } from 'bun:test'
import type { ScopeAgent, ScopeAgents } from '../../plugins/kit'
import { composeCatalog, type ScopeCatalog } from './compose'

const agent = (fullName: string, fields: Partial<ScopeAgent> = {}): ScopeAgent => ({
  pluginName: fullName.includes(':') ? fullName.split(':')[0]! : 'user',
  name: fullName.split(':').at(-1)!,
  fullName,
  label: fullName,
  description: fullName,
  prompt: `You are ${fullName}.`,
  source: fullName.includes(':') ? 'plugin' : 'user',
  path: '',
  ...fields,
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
        const found = agents.find((one) => one.fullName === reference)
        return found ? { agent: found } : null
      },
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
        agent('mine', { source: 'project', path: '/p/.claude/agents/mine.md' }),
        agent('home'),
        agent('lab:own', { plugin: { id: 'lab@x', scope: 'project' } }),
        agent('acme:lead', { plugin: { id: 'acme@x', scope: 'user' } }),
      ]),
      'p',
    )
    expect(catalog.found.map((one) => [one.fullName, one.projectId])).toEqual([
      ['mine', 'p'],
      ['home', ''],
      ['lab:own', 'p'],
      ['acme:lead', ''],
    ])
    expect(catalog.found.every((one) => one.bodyHash.length === 16)).toBe(true)
  })

  test("the built-ins run on Localix's prompts; general-purpose is the delegator; localix is added", () => {
    const catalog = composeCatalog(
      scope([
        agent('Explore', { source: 'builtin', prompt: '' }),
        agent('general-purpose', { source: 'builtin', prompt: '' }),
      ]),
      '',
    )
    expect(catalog.builtins.map((one) => [one.fullName, Boolean(one.prompt), one.self])).toEqual([
      ['Explore', true, undefined],
      ['general-purpose', false, true],
      ['localix', true, undefined],
    ])
    expect(catalog.resolve('localix')).toMatchObject({ agent: { source: 'builtin' } })
  })

  test('a file named localix takes the main agent’s name; a shadowed definition names its winner', () => {
    const lost = agent('helper', { description: 'mine' })
    const winner = agent('helper', { source: 'managed', description: 'org' })
    const catalog = composeCatalog(
      scope([agent('localix'), winner], {}, [{ agent: lost, by: winner }]),
      '',
    )
    const main = catalog.builtins.find((one) => one.fullName === 'localix')!
    expect(catalog.shadowedBy(main)?.source).toBe('user')
    const shadowed = catalog.found.find((one) => one.description === 'mine')!
    expect(catalog.shadowedBy(shadowed)?.description).toBe('org')
    expect(catalog.resolve('localix')).toMatchObject({ agent: { source: 'user' } })
  })
})
