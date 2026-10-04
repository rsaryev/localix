import { describe, expect, test } from 'bun:test'
import { createPluginIdentityGuard, pluginUiNamespaceProblems } from './plugin-identity-guard.mjs'

const guard = createPluginIdentityGuard({
  toolNames: ['plugin_tool'],
  commandNames: ['example-plugin:create'],
  agentNames: ['agent-owner:reviewer'],
  backendSubsystems: ['plugin-backend'],
  routeMounts: ['/rpc/plugin.route'],
  resourceProviders: ['plugin-resource'],
  searchProviders: ['plugin:search'],
  contextProviders: ['plugin.instructions'],
  wsCommands: ['plugin.subscribe'],
  channelNames: ['plugin-channel'],
  pluginNames: ['example-plugin'],
  uiContributionIds: ['example-plugin:workspace'],
})

describe('plugin identity boundary mutation matrix', () => {
  const mutations = [
    ['tool', `const toolName = 'plugin_tool'`],
    ['slash command', `composer.insert('/example-plugin:create')`],
    ['agent', `dispatch('agent-owner:reviewer')`],
    ['backend subsystem', `if (backendId === 'plugin-backend') start()`],
    ['route', `fetch('/rpc/plugin.route/status')`],
    ['resource namespace', `const uri = 'localix://resource/plugin-resource/item'`],
    ['search provider', `domains.includes('plugin:search')`],
    ['context provider', `const providerId = 'plugin.instructions'`],
    ['websocket command', `send({ type: 'plugin.subscribe' })`],
    ['channel', `if (channelName === 'plugin-channel') bridge()`],
    ['plugin name', `const pluginName = 'example-plugin'`],
    ['UI contribution', `open({ workKind: 'example-plugin:workspace' })`],
  ] as const

  for (const [surface, source] of mutations) {
    test(`turns red for a concrete ${surface}`, () => {
      expect(guard.inspect('apps/core/mutant.ts', source)).not.toEqual([])
    })
  }

  test('two copies never reclassify a leak as an allowed lexical collision', () => {
    expect(
      guard.inspect(
        'apps/core/double-mutant.ts',
        `const first = 'plugin_tool'\nconst second = 'plugin_tool'`,
      ),
    ).not.toEqual([])
  })

  test('owned backend and search ids are caught without relying on nearby variable names', () => {
    expect(
      guard.inspect('apps/core/backend-switch.ts', `case 'plugin-backend': break`),
    ).not.toEqual([])
    expect(guard.inspect('apps/core/search-list.ts', `['plugin:search']`)).not.toEqual([])
  })

  test('a previously unknown identity is still caught by its manifest-owned namespace', () => {
    expect(
      guard.inspect('apps/core/future-surface.ts', `open('example-plugin:future-surface')`),
    ).not.toEqual([])
  })

  test('catches plugin identities embedded in protocol values and settings URIs', () => {
    for (const source of [
      `const ref = 'plugin:example-plugin:server'`,
      `const source = 'channel:example-plugin:chat-1'`,
      `const uri = 'localix://ui/settings/plugins/plugin-example-plugin?scope=x'`,
      `const action = 'localix://ui/action/plugins/enable?id=example-plugin'`,
      `const tool = 'mcp__plugin_example-plugin_feed__quote'`,
    ]) {
      expect(guard.inspect('apps/core/embedded-mutant.ts', source)).not.toEqual([])
    }
  })

  test('core comments cannot document concrete plugin identities either', () => {
    expect(guard.inspect('apps/core/comment.ts', `// call plugin_tool here`)).not.toEqual([])
  })

  test('stays silent for descriptor-driven generic host code', () => {
    expect(
      guard.inspect(
        'apps/core/generic.ts',
        `for (const descriptor of registrations) host.mount(descriptor.id, descriptor.handler)`,
      ),
    ).toEqual([])
  })
})

describe('plugin UI identity namespace', () => {
  test('accepts only owner-prefixed global contribution identities', () => {
    expect(
      pluginUiNamespaceProblems([
        {
          id: 'sample-one:workspace',
          path: 'plugins/sample-one/ui/register.tsx',
          pluginName: 'sample-one',
        },
      ]),
    ).toEqual([])
  })

  test('rejects an unqualified identity before it can collide with core or a sibling plugin', () => {
    expect(
      pluginUiNamespaceProblems([
        {
          id: 'activity',
          path: 'plugins/sample-two/ui/register.tsx',
          pluginName: 'sample-two',
        },
      ]),
    ).toEqual([
      'plugins/sample-two/ui/register.tsx: plugin UI contribution "activity" is not namespaced by owner "sample-two:"',
    ])
  })
})
