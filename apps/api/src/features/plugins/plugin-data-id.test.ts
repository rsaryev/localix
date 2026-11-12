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
import { pluginDataDir } from './kit'
import { pluginIdOf } from './plugin-data-id'

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
    expect(pluginDataDir(pluginIdOf(cached), home())).toBe(
      join(home(), '.localix', 'plugin-data', 'tool-shop'),
    )
  })

  test('a plugin from no marketplace keeps its bare name', () => {
    expect(pluginIdOf(plugin({}))).toBe('tool')
  })
})
