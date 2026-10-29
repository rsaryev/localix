import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { cachedVersionDir, readInstallRecords } from './plugin-cache'
import { createPluginService } from './service'

/**
 * A plugin installed at user scope from a marketplace that Localix copies (here one added from its
 * catalog file) lands in the version cache, `cache/<marketplace>/<plugin>/<version>/`, as in Claude
 * Code. An update installs the new version beside the old one, which is marked `.orphaned_at`; an
 * unchanged version installs nothing; a failed update keeps the version before.
 */
const previous = process.env.CLAUDE_CONFIG_DIR
let root: string
let home: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

const manifestFile = () => join(root, 'market', 'plugins', 'tool', '.claude-plugin', 'plugin.json')
const setVersion = (version: string) =>
  writeFileSync(manifestFile(), JSON.stringify({ name: 'tool', version, description: 'Tool' }))
const listedTool = async () =>
  (await service.listPlugins('u1', { projectId: null })).plugins.find((p) => p.name === 'tool')

beforeAll(async () => {
  root = makeTempDir('versioned-install', {
    'market/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'shop',
      owner: { name: 'Shop' },
      plugins: [{ name: 'tool', source: './plugins/tool' }],
    }),
    'market/plugins/tool/commands/run.md': '---\ndescription: Run\n---\nRun it.\n',
    'market/plugins/tool/.claude-plugin/plugin.json': '{}',
    'home/.keep': '',
    'claude/.keep': '',
  })
  setVersion('1.0.0')
  home = join(root, 'home')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude')
  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({ db, capabilityStores, homeDir: home })
  await service.addMarketplace('u1', {
    source: join(root, 'market', '.claude-plugin', 'marketplace.json'),
  })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previous
})

describe('versioned marketplace installs', () => {
  test('an install lands in cache/<marketplace>/<plugin>/<version>/ with a record', async () => {
    const installed = await service.install('u1', { source: 'tool@shop', enable: true })
    const dir = cachedVersionDir(home, 'shop', 'tool', '1.0.0')
    expect(installed.dir).toBe(dir)
    expect(existsSync(join(dir, 'commands', 'run.md'))).toBe(true)
    expect(existsSync(join(home, '.localix', 'plugins', 'tool'))).toBe(false)
    expect((await readInstallRecords(home))['tool@shop']).toMatchObject({
      installPath: dir,
      version: '1.0.0',
    })
    expect(await listedTool()).toMatchObject({ dir, version: '1.0.0', enabled: true })
  })

  test('installing it again without replacing is refused as already installed', async () => {
    await expect(service.install('u1', { source: 'tool@shop' })).rejects.toMatchObject({
      code: 'plugin_already_installed',
    })
  })

  test('an update installs the new version beside the old one and orphans the old one', async () => {
    setVersion('2.0.0')
    const updated = await service.update('u1', { name: 'tool' })
    const oldDir = cachedVersionDir(home, 'shop', 'tool', '1.0.0')
    const newDir = cachedVersionDir(home, 'shop', 'tool', '2.0.0')
    expect(updated).toMatchObject({ dir: newDir, version: '2.0.0', enabled: true })
    expect(existsSync(join(oldDir, '.orphaned_at'))).toBe(true)
    expect(existsSync(join(newDir, '.orphaned_at'))).toBe(false)
    expect((await readInstallRecords(home))['tool@shop']?.version).toBe('2.0.0')
    expect((await listedTool())?.dir).toBe(newDir)
  })

  test('an update whose version did not change installs nothing', async () => {
    const before = readFileSync(
      join(cachedVersionDir(home, 'shop', 'tool', '2.0.0'), 'commands', 'run.md'),
      'utf8',
    )
    writeFileSync(join(root, 'market', 'plugins', 'tool', 'commands', 'run.md'), 'changed')
    const again = await service.update('u1', { name: 'tool' })
    expect(again).toMatchObject({ version: '2.0.0', upToDate: true })
    const dir = cachedVersionDir(home, 'shop', 'tool', '2.0.0')
    expect(readFileSync(join(dir, 'commands', 'run.md'), 'utf8')).toBe(before)
  })

  test('a failed update keeps the version before', async () => {
    writeFileSync(manifestFile(), '{ "name": "tool", "version": "3.0.0", ')
    await expect(service.update('u1', { name: 'tool' })).rejects.toThrow()
    expect((await readInstallRecords(home))['tool@shop']?.version).toBe('2.0.0')
    expect((await listedTool())?.version).toBe('2.0.0')
    setVersion('2.0.0')
  })

  test('an uninstall drops the record and orphans the version instead of deleting it', async () => {
    await service.remove('u1', { name: 'tool' })
    const dir = cachedVersionDir(home, 'shop', 'tool', '2.0.0')
    expect((await readInstallRecords(home))['tool@shop']).toBeUndefined()
    expect(existsSync(join(dir, '.orphaned_at'))).toBe(true)
    expect(await listedTool()).toBeUndefined()
  })

  // The Store's Remove then Get: the version left orphaned is the folder the install publishes to.
  test('installing it again after an uninstall takes back the orphaned version', async () => {
    await service.refreshMarketplaces('u1')
    const installed = await service.install('u1', { source: 'tool@shop', enable: true })
    const dir = cachedVersionDir(home, 'shop', 'tool', '2.0.0')
    expect(installed).toMatchObject({ dir, version: '2.0.0', enabled: true })
    expect(existsSync(join(dir, '.orphaned_at'))).toBe(false)
    expect((await readInstallRecords(home))['tool@shop']?.version).toBe('2.0.0')
  })
})
