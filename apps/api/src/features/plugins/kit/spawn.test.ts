import { describe, expect, test } from 'bun:test'
import {
  agentHooksRun,
  agentMcpSpecs,
  askedPermissionMode,
  subagentModelRoute,
  subagentPermissionMode,
} from './spawn'
import { testCatalogAgent } from './testing'
import type { AgentDefinition } from '@rsaryev/llx-plugin'

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
  const FILE: NonNullable<AgentDefinition['mcpServers']> = [
    'github',
    { playwright: { command: 'npx' } },
    { docs: { type: 'http', url: 'https://d' } },
  ]
  const managed = { kind: 'folder', scope: 'managed' } as const

  test('a personal file and a mod’s (`--agents`) load inline servers without trust', () => {
    for (const more of [{}, { source: { kind: 'flag' } }, { source: managed }] as const) {
      const specs = agentMcpSpecs(testCatalogAgent('a', { mcpServers: FILE }, more), 'dialog')
      expect(specs.references).toEqual(['github'])
      expect(Object.keys(specs.inline)).toEqual(['playwright', 'docs'])
    }
  })

  test('nothing for a plugin’s agent or a built-in type', () => {
    const none = { references: [], inline: {}, skipped: [] }
    for (const source of [{ kind: 'plugin', pluginId: 'p' }, { kind: 'builtin' }] as const)
      expect(
        agentMcpSpecs(testCatalogAgent('a', { mcpServers: FILE }, { source }), 'trusted'),
      ).toEqual(none)
  })

  // sub-agents.md, "Scope MCP servers to a subagent": a project file's inline servers wait for the
  // folder itself to be trusted (the kit's `subagent-inline-mcp` row); a parent's trust is not it.
  test('a project file’s inline servers load only once the folder itself is trusted', () => {
    const project = { source: { kind: 'folder', scope: 'project' } } as const
    const inline = (trust: 'trusted' | 'parent-trusted' | 'dialog') =>
      Object.keys(agentMcpSpecs(testCatalogAgent('a', { mcpServers: FILE }, project), trust).inline)
    expect(inline('trusted')).toEqual(['playwright', 'docs'])
    expect(inline('parent-trusted')).toEqual([])
    expect(inline('dialog')).toEqual([])
  })
})

// hooks.md, "Hooks in skills and agents": a project subagent's frontmatter hooks run only once the
// trust dialog was accepted for the folder itself (the kit's `subagent-frontmatter-hooks` row).
describe('the frontmatter hooks of an agent file', () => {
  const hooks = { PreToolUse: [{ hooks: [{ type: 'command' as const, command: 'true' }] }] }
  test('a project agent’s run only in a folder trusted itself; a personal one’s always', () => {
    const at = (scope: 'project' | 'user') =>
      testCatalogAgent('a', {}, { source: { kind: 'folder', scope }, hooks })
    expect(agentHooksRun(at('project'), 'trusted')).toBe(true)
    expect(agentHooksRun(at('project'), 'parent-trusted')).toBe(false)
    expect(agentHooksRun(at('project'), 'dialog')).toBe(false)
    expect(agentHooksRun(at('user'), 'dialog')).toBe(true)
  })
})
