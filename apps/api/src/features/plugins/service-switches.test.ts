import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerFile, tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { diskPluginHost } from './kit/testing'
import { createPluginService } from './service'

// What `claude plugin install|enable|disable|update` refuse, report or leave off.

const shared = tempDirPerFile('plugin-switches-env-')
const tempDir = tempDirPerTest('plugin-switches-')
const previous = {
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}
let db: ReturnType<typeof createDatabase> | undefined

beforeAll(() => {
  mkdirSync(join(shared(), 'claude'), { recursive: true })
  process.env.CLAUDE_CONFIG_DIR = join(shared(), 'claude')
})
afterAll(() => {
  for (const [key, value] of Object.entries(previous))
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
})
afterEach(async () => {
  if (db) await destroyDatabase(db)
  db = undefined
})

function writePlugin(dir: string, name: string, extra: Record<string, unknown> = {}) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  const manifest = { name, version: '1.0.0', description: `${name} plugin`, ...extra }
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
}

/** A local marketplace `market` with one plugin folder per entry of `plugins`. */
function writeMarket(dir: string, plugins: Record<string, Record<string, unknown>>) {
  const entries = Object.keys(plugins).map((name) => ({ name, source: `./plugins/${name}` }))
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(
    join(dir, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'market', owner: { name: 'E2E' }, plugins: entries }),
  )
  for (const [name, extra] of Object.entries(plugins))
    writePlugin(join(dir, 'plugins', name), name, extra)
}

async function setup() {
  const root = tempDir()
  const home = join(root, 'home')
  mkdirSync(home, { recursive: true })
  db = createDatabase()
  await migrateToLatest(db)
  const service = createPluginService({
    db,
    capabilityStores,
    homeDir: home,
    pluginHost: diskPluginHost(home),
  })
  return { root, service }
}

const code = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (err: { code?: string }) => err.code,
  )

describe('plugin switches', () => {
  test('disabling a plugin another enabled plugin depends on is refused', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'base'), 'base')
    writePlugin(join(root, 'top'), 'top', { dependencies: ['base'] })
    for (const name of ['base', 'top'])
      await service.install('u1', { source: join(root, name), projectId: null, enable: true })

    await expect(service.setEnabled('u1', { name: 'base', enabled: false })).rejects.toThrow(
      'Cannot disable "base": "top" depends on it; disable it first',
    )
    await service.setEnabled('u1', { name: 'top', enabled: false })
    expect(await service.setEnabled('u1', { name: 'base', enabled: false })).toMatchObject({
      enabled: false,
    })
  })

  test('enabling a plugin whose dependency is not installed fails and enables nothing', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'lone'), 'lone', { dependencies: ['ghost'] })
    await service.install('u1', { source: join(root, 'lone'), projectId: null })
    const enabling = service.setEnabled('u1', { name: 'lone', enabled: true })
    await expect(enabling).rejects.toThrow('Dependency "ghost" is not installed')
    const listed = (await service.listPlugins('u1', { projectId: null })).plugins
    expect(listed.find((p) => p.name === 'lone')?.enabled).toBe(false)
  })

  test("a plugin whose dependency is outside its range shows the kit's error", async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'base'), 'base', { version: '3.0.0' })
    writePlugin(join(root, 'top'), 'top', { dependencies: [{ name: 'base', version: '~2.1.0' }] })
    for (const name of ['base', 'top'])
      await service.install('u1', { source: join(root, name), projectId: null, enable: true })
    const listed = (await service.listPlugins('u1', { projectId: null })).plugins
    expect(listed.find((p) => p.name === 'top')?.error).toBe(
      'Requires "base" ~2.1.0, installed 3.0.0',
    )
    expect(listed.find((p) => p.name === 'base')?.error).toBeUndefined()
  })

  test('a plugin whose manifest stopped loading states the reason once', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'solo'), 'solo')
    await service.install('u1', { source: join(root, 'solo'), projectId: null, enable: true })
    const installed = join(root, 'home', '.localix', 'plugins', 'solo', '.claude-plugin')
    writeFileSync(join(installed, 'plugin.json'), '{ not json')
    const listed = (await service.listPlugins('u1', { projectId: null })).plugins
    const error = listed[0]?.error ?? ''
    expect(error).not.toBe('')
    expect(error).not.toContain('; ')
  })

  test('a plugin whose installed dependency is switched off says it is disabled, also when saved', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'top'), 'top', { dependencies: ['base'] })
    writePlugin(join(root, 'base'), 'base')
    await service.install('u1', { source: join(root, 'top'), projectId: null, enable: true })
    await service.install('u1', { source: join(root, 'base'), projectId: null })
    const disabled = 'Dependency "base" is disabled — enable it or remove the dependency'
    const listed = (await service.listPlugins('u1', { projectId: null })).plugins
    expect(listed.find((p) => p.name === 'top')?.error).toBe(disabled)
    // The single record a save answers with says the same.
    const saved = await service.setConfig('u1', { name: 'top', values: {} })
    expect(saved.error).toBe(disabled)
  })

  test("enabling a plugin whose dependency is outside its range answers with the kit's error", async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'base'), 'base', { version: '3.0.0' })
    writePlugin(join(root, 'top'), 'top', { dependencies: [{ name: 'base', version: '~2.1.0' }] })
    await service.install('u1', { source: join(root, 'base'), projectId: null, enable: true })
    await service.install('u1', { source: join(root, 'top'), projectId: null })
    const enabled = await service.setEnabled('u1', { name: 'top', enabled: true })
    expect(enabled.error).toBe('Requires "base" ~2.1.0, installed 3.0.0')
  })

  test('a switch or an install that changes nothing says the plugin already is', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'twice'), 'twice')
    const source = join(root, 'twice')
    await service.install('u1', { source, projectId: null, enable: true })
    const enable = { name: 'twice', enabled: true }
    expect(await code(service.setEnabled('u1', enable, { refuseNoop: true }))).toBe(
      'plugin_already_in_state',
    )
    // Settings' switch stays idempotent.
    expect(await code(service.setEnabled('u1', enable))).toBe('resolved')
    await expect(service.install('u1', { source, projectId: null, enable: true })).rejects.toThrow(
      'Plugin "twice" is already installed (scope: user)',
    )
  })

  test('a defaultEnabled false plugin installs turned off until it is enabled', async () => {
    const { root, service } = await setup()
    writePlugin(join(root, 'off'), 'off', { defaultEnabled: false })
    const rec = await service.install('u1', {
      source: join(root, 'off'),
      projectId: null,
      enable: true,
    })
    expect(rec.enabled).toBe(false)
    expect((await service.setEnabled('u1', { name: 'off', enabled: true })).enabled).toBe(true)
  })

  test('an install names the dependencies it installed alongside', async () => {
    const { root, service } = await setup()
    writeMarket(join(root, 'market'), { base: {}, top: { dependencies: ['base'] } })
    await service.addMarketplace('u1', { source: join(root, 'market') })
    const rec = await service.install('u1', { source: 'top@market', projectId: null, enable: true })
    expect(rec.installedDependencies).toEqual(['base'])
  })

  test('an update from a local-folder marketplace re-installs the folder as it is now', async () => {
    const { root, service } = await setup()
    const market = join(root, 'market')
    writeMarket(market, { solo: {} })
    await service.addMarketplace('u1', { source: market })
    await service.install('u1', { source: 'solo@market', projectId: null, enable: true })
    writePlugin(join(market, 'plugins', 'solo'), 'solo', { version: '1.1.0' })
    expect((await service.update('u1', { name: 'solo' })).version).toBe('1.1.0')
  })

  test('a plugin with an unknown key in a userConfig option is not installed', async () => {
    const { root, service } = await setup()
    const option = { type: 'string', title: 'Key', description: 'Key', bogus: true }
    writePlugin(join(root, 'strict'), 'strict', { userConfig: { key: option } })
    const install = service.install('u1', {
      source: join(root, 'strict'),
      projectId: null,
      enable: true,
    })
    await expect(install).rejects.toThrow(/Unrecognized key: "bogus"/)
  })
})
