import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerFile, tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'

// What `claude plugin install|enable|disable|update` refuse, report or leave off.

const shared = tempDirPerFile('plugin-switches-env-')
const tempDir = tempDirPerTest('plugin-switches-')
const previous = {
  LOCALIX_BUNDLED_PLUGINS_DIR: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}
let db: ReturnType<typeof createDatabase> | undefined

beforeAll(() => {
  for (const name of ['bundled', 'claude']) mkdirSync(join(shared(), name), { recursive: true })
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = join(shared(), 'bundled')
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
  const service = createPluginService({ db, capabilityStores, homeDir: home })
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
      'Plugin "base" is needed by top, which is enabled. Disable top first, then base.',
    )
    await service.setEnabled('u1', { name: 'top', enabled: false })
    expect(await service.setEnabled('u1', { name: 'base', enabled: false })).toMatchObject({
      enabled: false,
    })
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
