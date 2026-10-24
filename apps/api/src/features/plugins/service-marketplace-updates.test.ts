import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir, writeTree } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { readInstallRecords } from './plugin-cache'
import { createPluginService } from './service'

/**
 * The Marketplaces section as Claude Code has it: each marketplace says whether it auto-updates and
 * the person can turn that on or off; "Update marketplace" refreshes the listing and updates the
 * plugins installed from it, naming any it leaves for the person; `marketplace update` with no
 * name refreshes the listings only; removing the official `localix` marketplace is remembered.
 */
const previous = process.env.CLAUDE_CONFIG_DIR
let root: string
let home: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

const catalogFile = (dir: string) => join(root, dir, '.claude-plugin', 'marketplace.json')
const setVersion = (version: string) =>
  writeFileSync(
    join(root, 'market', 'plugins', 'tool', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'tool', version }),
  )
const version = async () => (await readInstallRecords(home))['tool@shop']?.version
const row = async (name: string) =>
  (await service.listMarketplaces('u1')).find((market) => market.name === name)

beforeAll(async () => {
  const entry = (name: string, extra = {}) => ({ name, source: `./plugins/${name}`, ...extra })
  root = makeTempDir('marketplace-updates', {
    'market/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'shop',
      plugins: [entry('tool'), entry('gated', { headersHelper: './headers.sh' })],
    }),
    'market/plugins/tool/.claude-plugin/plugin.json': '{}',
    'market/plugins/gated/.claude-plugin/plugin.json': JSON.stringify({ name: 'gated' }),
    'market/plugins/gated/commands/go.md': 'Go.\n',
    'market/plugins/tool/commands/run.md': 'Run.\n',
    'own/.claude-plugin/marketplace.json': JSON.stringify({ name: 'localix', plugins: [] }),
    'home/.keep': '',
    'claude/.keep': '',
  })
  setVersion('1.0.0')
  home = join(root, 'home')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({ db, capabilityStores, homeDir: home, env: {} })
  await service.addMarketplace('u1', { source: catalogFile('market') })
  await service.install('u1', { source: 'tool@shop', enable: true })
  await service.install('u1', { source: 'gated@shop', enable: true })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previous
})

describe('marketplace auto-update and updates', () => {
  test('a third-party marketplace is listed with auto-update off, and the toggle turns it on', async () => {
    expect(await row('shop')).toMatchObject({ autoUpdate: false })
    expect((await row('shop'))?.autoUpdatePaused).toBeUndefined()
    await service.setMarketplaceAutoUpdate('u1', { name: 'shop', autoUpdate: true })
    expect(await row('shop')).toMatchObject({ autoUpdate: true })
    await service.setMarketplaceAutoUpdate('u1', { name: 'shop', autoUpdate: false })
  })

  test('the toggle is shown as paused while an environment variable turns the pass off', async () => {
    const paused = createPluginService({
      db,
      capabilityStores,
      homeDir: home,
      env: { DISABLE_UPDATES: '1' },
    })
    expect((await paused.listMarketplaces('u1')).find((m) => m.name === 'shop')).toMatchObject({
      autoUpdatePaused: true,
    })
  })

  test('marketplace update with no name refreshes the listings and installs nothing', async () => {
    setVersion('2.0.0')
    expect(await service.refreshMarketplaces('u1')).toMatchObject({
      refreshed: ['shop'],
      updated: [],
    })
    expect(await version()).toBe('1.0.0')
  })

  test('Update marketplace updates its plugins and names the one it leaves for the person', async () => {
    const result = await service.updateMarketplace('u1', { name: 'shop' })
    expect(result.updated).toEqual(['tool'])
    expect(result.manual).toEqual(['gated'])
    expect(await version()).toBe('2.0.0')
  })

  test('removing the official localix marketplace is remembered; adding it again forgets that', async () => {
    const state = join(home, '.localix', 'marketplaces', '.official.json')
    writeTree(root, {})
    await service.addMarketplace('u1', { source: catalogFile('own') })
    await service.removeMarketplace('u1', { name: 'localix' })
    expect(existsSync(state)).toBe(true)
    await service.addMarketplace('u1', { source: catalogFile('own') })
    expect(existsSync(state)).toBe(false)
  })
})
