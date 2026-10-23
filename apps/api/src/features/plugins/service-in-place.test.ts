import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir, writeTree } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { readInPlaceRecords } from './in-place-installs'
import { createPluginService } from './service'

/**
 * Plugins from a marketplace added from a local folder load IN PLACE through the plugin service:
 * install records the folder instead of copying it, an edit there shows at the next discovery, and
 * no uninstall, update or marketplace removal ever deletes the person's folder.
 */

const previousEnv = {
  LOCALIX_BUNDLED_PLUGINS_DIR: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}
let root: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>
let run = 0
let home: string
let folder: string

const skill = (body: string) => `---\nname: hi\ndescription: Says hi\n---\n${body}\n`
const pluginsRoot = () => join(home, '.localix', 'plugins')
/** Every file of the person's folder still there, and nothing written into it. */
const folderIntact = () => {
  expect(existsSync(join(folder, '.claude-plugin', 'marketplace.json'))).toBe(true)
  expect(existsSync(join(folder, 'plugins', 'tool', 'skills', 'hi', 'SKILL.md'))).toBe(true)
  expect(existsSync(join(folder, 'plugins', 'tool', '.claude-plugin'))).toBe(false)
}

beforeAll(async () => {
  root = makeTempDir('in-place-service', { 'bundled/.keep': '', 'claude/.keep': '' })
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = join(root, 'bundled')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  db = createDatabase()
  await migrateToLatest(db)
})

beforeEach(() => {
  // A home and a marketplace folder per test; the database rows are per user.
  run += 1
  home = join(root, `home-${run}`)
  folder = join(root, `market-${run}`)
  writeTree(folder, {
    '.claude-plugin/marketplace.json': JSON.stringify({
      name: 'mine',
      owner: { name: 'Me' },
      plugins: [
        { name: 'tool', source: './plugins/tool', version: '1.0.0', description: 'A tool' },
      ],
    }),
    'plugins/tool/skills/hi/SKILL.md': skill('TOOL-V1'),
  })
  writeTree(home, { '.keep': '' })
  service = createPluginService({ db, capabilityStores, homeDir: home })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

const user = () => `u${run}`
const listed = async () =>
  (await service.listPlugins(user())).plugins.find((plugin) => plugin.name === 'tool')

describe('a plugin from a local-folder marketplace loads in place', () => {
  test('install records the folder, copies nothing, and an edit loads with no update', async () => {
    await service.addMarketplace(user(), { source: folder })
    const rec = await service.install(user(), { source: 'tool@mine', enable: true })
    expect(rec.loadsInPlace).toBe(true)
    expect(rec.dir).toBe(join(folder, 'plugins', 'tool'))
    expect(rec.source).toBe('tool@mine')
    expect(existsSync(join(pluginsRoot(), 'tool'))).toBe(false)
    expect(await readInPlaceRecords(pluginsRoot())).toEqual({
      tool: { id: 'tool@mine', dir: join(folder, 'plugins', 'tool') },
    })
    folderIntact()

    writeTree(join(folder, 'plugins', 'tool'), {
      'skills/more/SKILL.md': '---\nname: more\ndescription: More\n---\nMORE\n',
    })
    expect((await listed())?.provides.skills?.sort()).toEqual(['hi', 'more'])
    expect((await listed())?.version).toBe('1.0.0')

    // Installing it again is refused, as for a copy.
    await expect(service.install(user(), { source: 'tool@mine' })).rejects.toMatchObject({
      code: 'plugin_already_installed',
    })
  })

  test('remove drops the record and leaves the folder', async () => {
    await service.addMarketplace(user(), { source: folder })
    await service.install(user(), { source: 'tool@mine', enable: true })
    await service.remove(user(), { name: 'tool' })
    expect(await readInPlaceRecords(pluginsRoot())).toEqual({})
    expect(await listed()).toBeUndefined()
    folderIntact()
  })

  test('update checks the files again, keeps it in place, and leaves the folder', async () => {
    await service.addMarketplace(user(), { source: folder })
    await service.install(user(), { source: 'tool@mine', enable: true })
    const rec = await service.update(user(), { name: 'tool' })
    expect(rec.loadsInPlace).toBe(true)
    expect(rec.dir).toBe(join(folder, 'plugins', 'tool'))
    expect(existsSync(join(pluginsRoot(), 'tool'))).toBe(false)
    folderIntact()

    const refreshed = await service.updateMarketplace(user(), { name: 'mine' })
    expect(refreshed.updated).toEqual(['tool'])
    folderIntact()
  })

  test('removing the marketplace uninstalls the plugin and leaves the folder', async () => {
    await service.addMarketplace(user(), { source: folder })
    await service.install(user(), { source: 'tool@mine', enable: true })
    expect(await service.removeMarketplace(user(), { name: 'mine' })).toEqual({
      uninstalled: ['tool'],
    })
    expect(await readInPlaceRecords(pluginsRoot())).toEqual({})
    expect(await listed()).toBeUndefined()
    folderIntact()
  })

  test('an update turns a copy an older build installed into an in-place plugin', async () => {
    // What an older build left: a copy of the marketplace and of the plugin, and the row.
    const oldMarket = join(home, '.localix', 'marketplaces', 'mine')
    await fs.cp(folder, oldMarket, { recursive: true })
    writeTree(join(home, '.localix', 'marketplaces'), {
      'known.json': JSON.stringify({
        mine: { source: { source: 'local', path: folder }, installLocation: oldMarket },
      }),
    })
    const copied = await service.install(user(), { source: 'tool@mine', enable: true })
    expect(copied.dir).toBe(join(pluginsRoot(), 'tool'))
    expect(copied.loadsInPlace).toBeUndefined()

    const rec = await service.update(user(), { name: 'tool' })
    expect(rec.loadsInPlace).toBe(true)
    expect(rec.dir).toBe(join(folder, 'plugins', 'tool'))
    expect(existsSync(join(pluginsRoot(), 'tool'))).toBe(false)
    expect(existsSync(oldMarket)).toBe(false)
    folderIntact()
  })
})
