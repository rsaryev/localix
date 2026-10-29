/**
 * `${CLAUDE_PLUGIN_DATA}` is keyed by the plugin's identifier, `name@marketplace` with every
 * character other than a letter, digit, `_` or `-` replaced by `-` (plugins/manifest-reference,
 * "Environment variables"): `my-plugin@my-marketplace` keeps its data in `my-plugin-my-marketplace`.
 * A folder an earlier Localix kept under the bare name moves there once, its files kept.
 */
import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest } from '@localixai/testing'

import type { DiscoveredPlugin } from './discovery'
import type { LoadedPlugins } from './loader-contract'
import { appendPluginRuntimeDeclarations } from './loader-runtime-declarations'
import { pluginDataDirOf, pluginIdOf } from './plugin-data-id'

const home = tempDirPerTest('plugin-data-id-')

const plugin = (extra: Partial<DiscoveredPlugin>) =>
  ({
    dir: '/plugins/tool',
    manifest: { name: 'tool' },
    agents: [],
    entrypoints: { hookConfigs: [{ hooks: {} }], lspServers: {}, monitors: [] },
    ...extra,
  }) as unknown as DiscoveredPlugin

describe("a plugin's data directory", () => {
  test('is keyed by name@marketplace for a marketplace install', () => {
    const cached = plugin({ cachedInstall: { id: 'tool@shop', version: '1.0.0' } })
    expect(pluginIdOf(cached)).toBe('tool@shop')
    expect(pluginDataDirOf(pluginIdOf(cached), home())).toBe(
      join(home(), '.localix', 'plugin-data', 'tool-shop'),
    )
  })

  test("reaches the plugin's hooks as CLAUDE_PLUGIN_DATA", () => {
    const result = { ccHooks: [], lspServers: [], monitors: [], outputStyles: [] }
    appendPluginRuntimeDeclarations({
      plugin: plugin({ claudeCodeInstall: 'tool@official' }),
      config: {},
      subst: (text) => text,
      result: result as unknown as LoadedPlugins,
      summary: {} as LoadedPlugins['loaded'][number],
      opts: { homeDir: home() },
    })
    expect((result.ccHooks[0] as { dataDir: string }).dataDir).toBe(
      join(home(), '.localix', 'plugin-data', 'tool-official'),
    )
  })

  test('a plugin from no marketplace keeps its bare name', () => {
    expect(pluginIdOf(plugin({}))).toBe('tool')
  })
})
