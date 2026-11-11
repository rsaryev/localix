import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'

import type { AvailabilityReader } from '../capabilities/availability'
import type { CapabilitySourceRepository } from '../capabilities/source-repository'
import { trustFallback } from '../ext/trust'
import { diskPluginHost } from './kit/testing'
import { loadEnabledPlugins } from './loader'
import { loadEnabledPluginMods } from './loader-declarative'
import { setInstallRecord } from './plugin-cache'

/**
 * Whether a plugin runs is one verdict, the kit's, as a chat session judges it: managed settings'
 * `enabledPlugins` turn a plugin off whatever the agent's rules say (a policy the native loader
 * may not bypass), and on, with a dependency they turn on too, when the agent did not switch them
 * on. Managed settings key plugins by `name@marketplace`, so these are marketplace installs.
 */
const dir = tempDirPerTest('loader-managed-')

const repo: CapabilitySourceRepository = {
  listForScope: async () => [],
  get: async () => null,
  upsert: async () => {
    throw new Error('not written')
  },
  patchConfig: async () => {
    throw new Error('not written')
  },
  remove: async () => {},
}

const allowing = (...names: string[]): AvailabilityReader => ({
  effectFor: (_kind, name, trust = 'bundled') =>
    names.includes(name) ? 'allow' : trustFallback(trust),
})

/** `app@mk` (a bundled CLI and a hooks module) needs `lib@mk`; both installed from `mk`. */
async function installed() {
  const home = join(dir(), 'home')
  const market = join(dir(), 'market')
  writeTree(market, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mk',
      owner: { name: 'Me' },
      plugins: [
        { name: 'app', source: './app' },
        { name: 'lib', source: './lib' },
      ],
    }),
  })
  writeTree(home, {
    '.localix/marketplaces/known_marketplaces.json': JSON.stringify({
      mk: { source: { source: 'directory', path: market }, installLocation: market },
    }),
  })
  const copies = {
    app: {
      '.claude-plugin/plugin.json': JSON.stringify({
        name: 'app',
        version: '1.0.0',
        dependencies: ['lib'],
      }),
      'bin/app-tool': '#!/bin/sh\n',
      'hooks/hooks.json': JSON.stringify({ hooks: {}, modules: ['./register.js'] }),
      'hooks/register.js': 'export function register() {}',
    },
    lib: { '.claude-plugin/plugin.json': JSON.stringify({ name: 'lib', version: '1.0.0' }) },
  }
  for (const [name, files] of Object.entries(copies)) {
    const installPath = join(home, '.localix/plugins/cache/mk', name, '1.0.0')
    writeTree(installPath, files)
    await setInstallRecord(home, `${name}@mk`, {
      installPath,
      version: '1.0.0',
      installedAt: '',
      lastUpdated: '',
    })
  }
  return home
}

/** Managed settings with these `enabledPlugins`, as an administrator writes them. */
function managedEnabling(enabledPlugins: Record<string, boolean>) {
  const managed = join(dir(), 'managed')
  writeTree(managed, { 'managed-settings.json': JSON.stringify({ enabledPlugins }) })
  return { dir: managed }
}

async function load(availability: AvailabilityReader, enabledPlugins: Record<string, boolean>) {
  const home = await installed()
  const scope = {
    repo,
    availability,
    userId: 'u1',
    projectId: '',
    cwd: join(dir(), 'work'),
    homeDir: home,
    pluginHost: diskPluginHost(home),
    managed: managedEnabling(enabledPlugins),
  }
  const [native, mods] = await Promise.all([
    loadEnabledPlugins(scope),
    loadEnabledPluginMods(scope),
  ])
  return { native, mods: mods.map((one) => one.plugin) }
}

describe("managed settings' enabledPlugins in every loader", () => {
  test('a plugin they turn off starts nothing, though the agent switched it on', async () => {
    const { native, mods } = await load(allowing('app', 'lib'), { 'app@mk': false })
    expect(native.binDirs.filter((bin) => bin.includes('/app/'))).toEqual([])
    expect(native.loaded.map((one) => one.name)).toEqual(['lib'])
    expect(mods).toEqual([])
  })

  test('a plugin and its dependency they turn on start, though the agent did not', async () => {
    const { native, mods } = await load(allowing(), { 'app@mk': true, 'lib@mk': true })
    const app = native.loaded.find((one) => one.name === 'app')
    expect(app?.error).toBeUndefined()
    expect(app?.binDir).toBe(join(dir(), 'home/.localix/plugins/cache/mk/app/1.0.0/bin'))
    expect(mods).toEqual(['app'])
  })

  test("a plugin they turn on whose dependency stays off says so in the kit's words", async () => {
    const { native, mods } = await load(allowing(), { 'app@mk': true })
    expect(native.loaded.find((one) => one.name === 'app')).toMatchObject({
      error: 'Dependency "lib@mk" is disabled — enable it or remove the dependency',
      binDir: undefined,
    })
    expect(mods).toEqual([])
  })
})
