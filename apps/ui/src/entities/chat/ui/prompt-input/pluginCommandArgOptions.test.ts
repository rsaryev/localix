import { afterEach, describe, expect, test } from 'bun:test'
import type { CapabilitySnapshot, MiniAppRecord, PluginRecord } from '@/shared/api/contracts'
import { __resetMiniAppContrib, refetchMiniAppContrib } from '@/shared/contrib/enabledMiniApps'
import { backendClient } from '@/shared/api/client'
import {
  loadMiniAppCommandArgOptions,
  loadPluginCommandArgOptions,
} from './pluginCommandArgOptions'

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

function app(name: string, over: Partial<MiniAppRecord> = {}): MiniAppRecord {
  return { name, enabled: true, projectId: '', scope: 'global', ...over } as MiniAppRecord
}

async function installed(plugins: PluginRecord[], miniApps: MiniAppRecord[] = []): Promise<void> {
  await refetchMiniAppContrib({
    loadSnapshot: async () => ({
      revision: 1,
      scope: { projectId: '', agentId: null },
      plugins,
      miniApps,
      tools: EMPTY_TOOLS,
      views: [],
      themes: [],
      agents: [],
      commands: [],
      miniAppCommands: [],
      mcp: [],
      skills: [],
      tips: [],
      grammar: { kinds: [], effects: [], classes: [], examples: [] },
    }),
  })
}

const realListMarketplaces = backendClient.listMarketplaces.bind(backendClient)

afterEach(() => {
  __resetMiniAppContrib()
  backendClient.listMarketplaces = realListMarketplaces
})

describe('loadPluginCommandArgOptions', () => {
  test('offers Claude Code plugins only, never a mini app', async () => {
    await installed([plugin('formatter')], [app('chess')])
    const options = await loadPluginCommandArgOptions('plugin', 'remove', '')
    expect(options.map((o) => o.value)).toEqual(['formatter'])
  })

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
    await installed([plugin('acme'), plugin('library', { projectId: 'p1' })])

    const filtered = await loadPluginCommandArgOptions('plugin', 'details', 'lib')
    expect(filtered.map((o) => o.value)).toEqual(['library'])
    expect(filtered[0].description).toBe('v1.0.0 · enabled · project')
  })

  test('validate offers --strict alongside the plugin names', async () => {
    await installed([plugin('acme')])
    const options = await loadPluginCommandArgOptions('target', 'validate', '')
    expect(options.map((o) => o.value)).toEqual(['--strict', 'acme'])
  })

  test('install offers marketplace entries in the exact <name>@<marketplace> form', async () => {
    backendClient.listMarketplaces = async () => [
      { name: 'tools', count: 1, plugins: [{ name: 'acme', description: 'Acme data' }] },
    ]
    const options = await loadPluginCommandArgOptions('source', 'install', '')
    expect(options).toEqual([{ value: 'acme@tools', label: 'acme', description: 'Acme data' }])
  })

  test('marketplace remove offers registered marketplaces with their size', async () => {
    backendClient.listMarketplaces = async () => [
      { name: 'tools', count: 2, plugins: [] },
      { name: 'acme', count: 1, plugins: [] },
    ]
    const options = await loadPluginCommandArgOptions('market', 'marketplace', '')
    expect(options.map((o) => o.value)).toEqual(['tools', 'acme'])
    expect(options[0].description).toBe('2 plugins')
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

describe('loadMiniAppCommandArgOptions', () => {
  test('enable offers the mini apps that are off, disable those that are on, never a plugin', async () => {
    await installed([plugin('formatter')], [app('chess'), app('notes', { enabled: false })])
    expect((await loadMiniAppCommandArgOptions('app', 'enable', '')).map((o) => o.value)).toEqual([
      'notes',
    ])
    expect((await loadMiniAppCommandArgOptions('app', 'disable', '')).map((o) => o.value)).toEqual([
      'chess',
    ])
    expect((await loadMiniAppCommandArgOptions('app', 'remove', 'ch')).map((o) => o.label)).toEqual(
      ['chess'],
    )
  })
})

describe('/mini-app catalog remove', () => {
  test('offers the catalogs the person added, never the built-in one', async () => {
    const real = backendClient.listMiniAppCatalogs.bind(backendClient)
    backendClient.listMiniAppCatalogs = async () => [
      {
        url: 'https://github.com/rsaryev/localix/releases/latest/download/mini-app-catalog.json',
        builtIn: true,
      },
      { url: 'https://ada.test/mini-app-catalog.json', builtIn: false },
      { url: 'file:///Users/ada/catalog/mini-app-catalog.json', builtIn: false },
    ]
    try {
      const options = await loadMiniAppCommandArgOptions('catalog', 'catalog', '')
      expect(options.map((o) => [o.value, o.label])).toEqual([
        ['https://ada.test/mini-app-catalog.json', 'ada.test'],
        ['file:///Users/ada/catalog/mini-app-catalog.json', 'A folder on this computer'],
      ])
      expect(
        (await loadMiniAppCommandArgOptions('catalog', 'catalog', 'ada.test')).map((o) => o.label),
      ).toEqual(['ada.test'])
    } finally {
      backendClient.listMiniAppCatalogs = real
    }
  })
})
