import { afterEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot, PluginRecord } from '@/shared/api/contracts'
import { __resetPluginContrib, refetchPluginContrib } from '@/shared/contrib/enabledPlugins'
import { backendClient } from '@/shared/api/client'
import { loadPluginCommandArgOptions } from './pluginCommandArgOptions'

/**
 * The `/plugin` composer pickers. Every value here already exists client-side — the
 * installed set in the capability snapshot, the catalog entries on each marketplace
 * listing — yet the argument used to be one free-text slot, so the user retyped names
 * the app had on screen.
 */

function plugin(name: string, over: Partial<PluginRecord> = {}): PluginRecord {
  return { name, enabled: true, version: '1.0.0', projectId: '', ...over } as PluginRecord
}

const EMPTY_TOOLS: CapabilitySnapshot['tools'] = {
  enabled: [],
  disabled: [],
  catalog: [],
  categoryLabels: {},
  mcp: [],
  mcpUnprobedServers: [],
}

async function installed(plugins: PluginRecord[]): Promise<void> {
  await refetchPluginContrib({
    loadSnapshot: async () => ({
      revision: 1,
      scope: { projectId: '', agentId: null, sessionId: null },
      plugins,
      tools: EMPTY_TOOLS,
      views: [],
      themes: [],
      agents: [],
      commands: [],
      mcp: [],
      skills: [],
      tips: [],
      grammar: { kinds: [], effects: [], classes: [], examples: [] },
    }),
  })
}

const realListMarketplaces = backendClient.listMarketplaces.bind(backendClient)

afterEach(() => {
  __resetPluginContrib()
  backendClient.listMarketplaces = realListMarketplaces
})

describe('loadPluginCommandArgOptions', () => {
  test('enable offers only what is OFF, disable only what is ON', async () => {
    await installed([plugin('running'), plugin('parked', { enabled: false })])

    const toEnable = await loadPluginCommandArgOptions('plugin', 'enable', '')
    expect(toEnable.map((o) => o.value)).toEqual(['parked'])

    const toDisable = await loadPluginCommandArgOptions('plugin', 'disable', '')
    expect(toDisable.map((o) => o.value)).toEqual(['running'])
  })

  test('remove, update and details offer the whole installed set', async () => {
    await installed([plugin('running'), plugin('parked', { enabled: false })])
    for (const action of ['remove', 'update', 'details']) {
      const options = await loadPluginCommandArgOptions('plugin', action, '')
      expect(options.map((o) => o.value).sort()).toEqual(['parked', 'running'])
    }
  })

  test('the query filters by name, and the description carries state + scope', async () => {
    await installed([plugin('acme'), plugin('library', { bundled: true })])

    const filtered = await loadPluginCommandArgOptions('plugin', 'details', 'lib')
    expect(filtered.map((o) => o.value)).toEqual(['library'])
    expect(filtered[0].description).toBe('v1.0.0 · enabled · bundled')
  })

  test('validate offers --strict alongside the plugin names', async () => {
    await installed([plugin('acme')])
    const options = await loadPluginCommandArgOptions('target', 'validate', '')
    expect(options.map((o) => o.value)).toEqual(['--strict', 'acme'])
  })

  test('install offers marketplace entries in the exact <name>@<marketplace> form', async () => {
    backendClient.listMarketplaces = async () => [
      {
        name: 'localix',
        builtin: true,
        count: 1,
        plugins: [{ name: 'acme', description: 'Acme data' }],
      },
    ]
    const options = await loadPluginCommandArgOptions('source', 'install', '')
    expect(options).toEqual([{ value: 'acme@localix', label: 'acme', description: 'Acme data' }])
  })

  test('marketplace remove offers registered marketplaces with their size', async () => {
    backendClient.listMarketplaces = async () => [
      { name: 'localix', builtin: true, count: 2, plugins: [] },
      { name: 'acme', builtin: false, count: 1, plugins: [] },
    ]
    const options = await loadPluginCommandArgOptions('market', 'marketplace', '')
    expect(options.map((o) => o.value)).toEqual(['localix', 'acme'])
    expect(options[0].description).toBe('2 plugins · built-in')
    expect(options[1].description).toBe('1 plugin')
  })

  test('a failed marketplace fetch yields no options rather than throwing', async () => {
    backendClient.listMarketplaces = async () => {
      throw new Error('offline')
    }
    expect(await loadPluginCommandArgOptions('source', 'install', '')).toEqual([])
  })

  test('an argument with no live source resolves to nothing', async () => {
    expect(await loadPluginCommandArgOptions('msource', 'marketplace', '')).toEqual([])
  })
})
