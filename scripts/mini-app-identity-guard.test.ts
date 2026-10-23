import { describe, expect, test } from 'bun:test'
import {
  createMiniAppIdentityGuard,
  miniAppUiNamespaceProblems,
} from './mini-app-identity-guard.mjs'

const catalogFor = (toolNames: string[]) => ({
  toolNames,
  commandNames: ['example-mini-app:create'],
  agentNames: ['agent-owner:reviewer'],
  backendSubsystems: ['mini-app-backend'],
  routeMounts: ['/rpc/mini-app.route'],
  resourceProviders: ['mini-app-resource'],
  searchProviders: ['mini-app:search'],
  contextProviders: ['mini-app.instructions'],
  wsCommands: ['mini-app.subscribe'],
  channelNames: ['mini-app-channel'],
  miniAppNames: ['example-mini-app'],
  uiContributionIds: ['example-mini-app:workspace'],
})
const guard = createMiniAppIdentityGuard(catalogFor(['mini_app_tool']))

describe('mini app identity boundary mutation matrix', () => {
  const mutations = [
    ['tool', `const toolName = 'mini_app_tool'`],
    ['slash command', `composer.insert('/example-mini-app:create')`],
    ['agent', `dispatch('agent-owner:reviewer')`],
    ['backend subsystem', `if (backendId === 'mini-app-backend') start()`],
    ['route', `fetch('/rpc/mini-app.route/status')`],
    ['resource namespace', `const uri = 'localix://resource/mini-app-resource/item'`],
    ['search provider', `domains.includes('mini-app:search')`],
    ['context provider', `const providerId = 'mini-app.instructions'`],
    ['websocket command', `send({ type: 'mini-app.subscribe' })`],
    ['channel', `if (channelName === 'mini-app-channel') bridge()`],
    ['mini app name', `const miniAppName = 'example-mini-app'`],
    ['UI contribution', `open({ workKind: 'example-mini-app:workspace' })`],
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
        `const first = 'mini_app_tool'\nconst second = 'mini_app_tool'`,
      ),
    ).not.toEqual([])
  })

  test('owned backend and search ids are caught without relying on nearby variable names', () => {
    expect(
      guard.inspect('apps/core/backend-switch.ts', `case 'mini-app-backend': break`),
    ).not.toEqual([])
    expect(guard.inspect('apps/core/search-list.ts', `['mini-app:search']`)).not.toEqual([])
  })

  test('a previously unknown identity is still caught by its manifest-owned namespace', () => {
    expect(
      guard.inspect('apps/core/future-surface.ts', `open('example-mini-app:future-surface')`),
    ).not.toEqual([])
  })

  test('catches mini app identities embedded in protocol values and settings URIs', () => {
    for (const source of [
      `const ref = 'mini-app:example-mini-app:server'`,
      `const source = 'channel:example-mini-app:chat-1'`,
      `const uri = 'localix://ui/settings/mini-apps/mini-app-example-mini-app?scope=x'`,
      `const action = 'localix://ui/action/mini-apps/enable?id=example-mini-app'`,
      `const tool = 'mcp__plugin_example-mini-app_feed__quote'`,
    ]) {
      expect(guard.inspect('apps/core/embedded-mutant.ts', source)).not.toEqual([])
    }
  })

  test('core comments cannot document concrete mini app identities either', () => {
    expect(guard.inspect('apps/core/comment.ts', `// call mini_app_tool here`)).not.toEqual([])
  })

  test('a one-word tool name counts only where it is quoted, not as prose', () => {
    const wordGuard = createMiniAppIdentityGuard({ ...catalogFor(['notes']) })
    expect(wordGuard.inspect('apps/core/a.ts', `// notes for the turn after approval`)).toEqual([])
    expect(wordGuard.inspect('apps/core/b.ts', `const toolName = 'notes'`)).toEqual([
      'apps/core/b.ts: production core names concrete mini app tool "notes"; consume descriptor metadata or a generic SDK result contract instead',
    ])
    expect(wordGuard.inspect('apps/core/c.ts', `const action = 'notes'`)).toEqual([])
    expect(wordGuard.inspect('apps/core/d.ts', `if (tool === 'notes') run()`)).not.toEqual([])
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

describe('mini app UI identity namespace', () => {
  test('accepts only owner-prefixed global contribution identities', () => {
    expect(
      miniAppUiNamespaceProblems([
        {
          id: 'sample-one:workspace',
          path: 'mini-apps/sample-one/ui/register.tsx',
          miniAppName: 'sample-one',
        },
      ]),
    ).toEqual([])
  })

  test('rejects an unqualified identity before it can collide with core or a sibling mini app', () => {
    expect(
      miniAppUiNamespaceProblems([
        {
          id: 'activity',
          path: 'mini-apps/sample-two/ui/register.tsx',
          miniAppName: 'sample-two',
        },
      ]),
    ).toEqual([
      'mini-apps/sample-two/ui/register.tsx: mini app UI contribution "activity" is not namespaced by owner "sample-two:"',
    ])
  })
})
