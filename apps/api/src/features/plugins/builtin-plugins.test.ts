import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'

const previous = process.env.LOCALIX_BUILTIN_PLUGINS_DIR
let root: string
let homeDir: string
let builtinDir: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

function writePlugin(dir: string, manifest: Record<string, unknown>) {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
  mkdirSync(join(dir, 'commands'), { recursive: true })
  writeFileSync(join(dir, 'commands', 'hello.md'), '---\ndescription: Say hello\n---\nSay hello.\n')
}

const listed = async () => (await service.listPlugins('u1', { projectId: null })).plugins
const find = async (name: string) => (await listed()).find((plugin) => plugin.name === name)

beforeAll(async () => {
  root = makeTempDir('builtin-plugins-')
  homeDir = join(root, 'home')
  builtinDir = join(root, 'resources', 'builtin-plugins')
  mkdirSync(homeDir, { recursive: true })
  writePlugin(join(builtinDir, 'guide'), { name: 'guide', version: '0.1.0', description: 'Guide' })
  writePlugin(join(builtinDir, 'quiet'), { name: 'quiet', version: '1.0.0', defaultEnabled: false })
  process.env.LOCALIX_BUILTIN_PLUGINS_DIR = builtinDir
  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({ db, capabilityStores, homeDir })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  if (previous === undefined) delete process.env.LOCALIX_BUILTIN_PLUGINS_DIR
  else process.env.LOCALIX_BUILTIN_PLUGINS_DIR = previous
})

describe('built-in plugins', () => {
  test('a plugin shipped with Localix is listed as built-in and is on by default', async () => {
    const guide = await find('guide')
    expect(guide).toMatchObject({ builtin: true, source: 'builtin', enabled: true })
    expect(guide?.awaitingConsent).toBeUndefined()
  })

  test('a built-in plugin whose manifest says defaultEnabled: false starts off', async () => {
    expect((await find('quiet'))?.enabled).toBe(false)
  })

  test('the person can turn a built-in plugin off and on again', async () => {
    await service.setEnabled('u1', { name: 'guide', enabled: false })
    expect((await find('guide'))?.enabled).toBe(false)
    await service.setEnabled('u1', { name: 'guide', enabled: true })
    expect((await find('guide'))?.enabled).toBe(true)
  })

  test('a built-in plugin cannot be uninstalled or updated on its own', async () => {
    await expect(service.remove('u1', { name: 'guide' })).rejects.toMatchObject({
      code: 'plugin_builtin',
    })
    await expect(service.update('u1', { name: 'guide' })).rejects.toMatchObject({
      code: 'plugin_builtin',
    })
    expect((await find('guide'))?.builtin).toBe(true)
  })

  test('installing a plugin under a built-in name is refused', async () => {
    const source = join(root, 'src', 'guide')
    writePlugin(source, { name: 'guide', version: '9.0.0' })
    await expect(service.install('u1', { source, projectId: null })).rejects.toMatchObject({
      code: 'plugin_builtin',
    })
  })

  test('a copy of the same name elsewhere does not load, and the built-in one says so', async () => {
    const copy = join(homeDir, '.localix', 'plugins', 'guide')
    writePlugin(copy, { name: 'guide', version: '9.9.9' })
    const plugins = await listed()
    const guides = plugins.filter((plugin) => plugin.name === 'guide')
    expect(guides).toHaveLength(1)
    expect(guides[0]).toMatchObject({ builtin: true, version: '0.1.0' })
    expect(guides[0]!.validation.warnings.join('\n')).toContain(copy)
    removeDir(copy)
  })
})
