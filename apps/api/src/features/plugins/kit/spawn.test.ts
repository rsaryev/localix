import { describe, expect, test } from 'bun:test'
import {
  agentMcpSpecs,
  askedPermissionMode,
  preloadedSkillNames,
  subagentModelRoute,
  subagentPermissionMode,
} from './spawn'

describe('what a subagent starts with', () => {
  test('preloads the first 32 distinct names, skipping a missing or user-only skill in its place', () => {
    const skills = new Map([
      ['manual', { disableModelInvocation: true }],
      ...Array.from({ length: 40 }, (_, i) => [`s${i}`, {}] as const),
    ])
    const names = ['manual', 'gone', 's0', 's0', ...Array.from({ length: 40 }, (_, i) => `s${i}`)]
    const load = preloadedSkillNames(names, (name) => skills.get(name))
    expect(load[0]).toBe('s0')
    expect(load).toHaveLength(30)
  })
})

// sub-agents.md, "Choose a model": the definition's `model` is an alias, a full id or `inherit`; an
// alias of the main model's family, and `opus` when that family cannot be told, is the main model.
describe('the model of a delegated child the person chose none for', () => {
  const available = ['claude-haiku-4-5', 'claude-sonnet-4-5', 'gpt-6']
  test.each([
    [undefined, 'claude-sonnet-4-5', {}],
    ['inherit', 'claude-sonnet-4-5', {}],
    ['sonnet', 'claude-sonnet-4-5', {}],
    ['haiku', 'claude-sonnet-4-5', { modelId: 'claude-haiku-4-5', providerConnectionId: null }],
    ['haiku', 'gpt-6', { modelId: 'claude-haiku-4-5', providerConnectionId: null }],
    ['opus', 'gpt-6', {}],
    ['fable', 'claude-sonnet-4-5', {}],
    ['gpt-6', 'claude-sonnet-4-5', { modelId: 'gpt-6', providerConnectionId: null }],
    ['claude-opus-9', 'claude-sonnet-4-5', {}],
  ])('model %p on %p routes %p', (model, mainModel, route) => {
    expect(subagentModelRoute({ definition: model }, { mainModel, available }, {})).toEqual(route)
  })

  test("the call's alias comes before the file's, the environment's after it; forced, only it", () => {
    const context = { mainModel: 'claude-sonnet-4-5', available }
    const haiku = { modelId: 'claude-haiku-4-5', providerConnectionId: null }
    expect(subagentModelRoute({ definition: 'sonnet', invocation: 'haiku' }, context, {})).toEqual(
      haiku,
    )
    const env = { CLAUDE_CODE_SUBAGENT_MODEL: 'gpt-6' }
    expect(subagentModelRoute({}, context, env)).toEqual({
      modelId: 'gpt-6',
      providerConnectionId: null,
    })
    expect(subagentModelRoute({ definition: 'haiku' }, context, env)).toEqual(haiku)
    const forced = { ...env, CLAUDE_CODE_SUBAGENT_MODEL_FORCE: '1' }
    expect(subagentModelRoute({ invocation: 'haiku' }, context, forced)).toEqual({
      modelId: 'gpt-6',
      providerConnectionId: null,
    })
  })
})

// sub-agents.md, "Permission modes": the main conversation's mode decides whether the agent's own
// applies. Localix has only Default and Plan among the modes an agent file names.
describe('the permission mode of a delegated child', () => {
  test.each([
    ['default', 'default'],
    ['manual', 'default'],
    ['plan', 'plan'],
    ['acceptEdits', undefined],
    ['auto', undefined],
    ['dontAsk', undefined],
    ['bypassPermissions', undefined],
    ['nonsense', undefined],
    [undefined, undefined],
  ] as const)('an agent file saying %s asks for %s', (written, asked) => {
    expect(askedPermissionMode(written)).toBe(asked)
  })

  test.each([
    ['default', 'plan', 'plan'],
    ['default', 'default', 'default'],
    ['default', undefined, 'default'],
    ['plan', 'default', 'plan'],
    ['bypass', 'plan', 'bypass'],
    ['autonomous', 'plan', 'autonomous'],
    ['bypass', 'default', 'bypass'],
  ] as const)('a %s conversation with an agent asking %s runs it in %s', (parent, asked, mode) => {
    expect(subagentPermissionMode(parent, asked)).toBe(mode)
  })
})

// sub-agents.md, "Scope MCP servers to a subagent": a string names a configured server; a project
// file's inline servers wait for its folder's trust; a plugin's agent has none.
describe('the MCP servers of an agent file', () => {
  const FILE = ['github', { playwright: { command: 'npx' } }, { docs: { url: 'https://d' } }]

  test('a personal file and a mod’s (`--agents`) load inline servers without trust', () => {
    for (const source of ['user', 'flag', 'managed']) {
      const specs = agentMcpSpecs(FILE, { source, folderTrusted: false })
      expect(specs.references).toEqual(['github'])
      expect(Object.keys(specs.inline)).toEqual(['playwright', 'docs'])
    }
  })

  test('a project file’s inline servers wait for trust; its references do not', () => {
    expect(agentMcpSpecs(FILE, { source: 'project', folderTrusted: false })).toEqual({
      references: ['github'],
      inline: {},
      skipped: ['playwright', 'docs'],
    })
    const trusted = agentMcpSpecs(FILE, { source: 'project', folderTrusted: true })
    expect(Object.keys(trusted.inline)).toEqual(['playwright', 'docs'])
  })

  test('nothing for a plugin’s agent or a built-in type', () => {
    const none = { references: [], inline: {}, skipped: [] }
    expect(agentMcpSpecs(FILE, { source: 'plugin', folderTrusted: true })).toEqual(none)
    expect(agentMcpSpecs(FILE, { source: 'builtin', folderTrusted: true })).toEqual(none)
  })
})
