import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { tempDirPerFile, tempDirPerTest } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { UNDECIDED } from '../capabilities/availability'
import { pluginDataDir } from '../ext/user-config-substitute'
import { buildPluginCatalog } from './catalog'
import { observeOptionVault, type OptionVaultPort } from '../ext/option-vault'
import { createPluginService } from './service'

// Where a plugin's state lives and when it goes: one userConfig per user for a user-scope plugin,
// sensitive values in the vault, an update at the plugin's own scope, and the data directory
// removed with the last copy.

const shared = tempDirPerFile('plugin-config-scope-env-')
const tempDir = tempDirPerTest('plugin-config-scope-')
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
  observeOptionVault(undefined)
  if (db) await destroyDatabase(db)
  db = undefined
})

const userConfig = {
  api_url: { type: 'string', title: 'URL', description: 'URL' },
  api_token: { type: 'string', title: 'Token', description: 'Token', sensitive: true },
}

function writePlugin(dir: string, name: string, version = '1.0.0') {
  mkdirSync(join(dir, '.claude-plugin'), { recursive: true })
  const manifest = { name, version, description: `${name} plugin`, userConfig }
  writeFileSync(join(dir, '.claude-plugin', 'plugin.json'), JSON.stringify(manifest))
}

/** A service whose project `p1` has a folder and whose `pdefault` (the Default project) has none. */
async function setup() {
  const root = tempDir()
  const home = join(root, 'home')
  const workspace = join(root, 'workspace')
  mkdirSync(home, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  db = createDatabase()
  await migrateToLatest(db)
  const service = createPluginService({
    db,
    capabilityStores,
    homeDir: home,
    resolveProjectCwd: async (_userId, projectId) => (projectId === 'p1' ? workspace : null),
  })
  const src = join(root, 'src-cfg')
  writePlugin(src, 'cfg')
  await service.install('u1', { source: src, projectId: null, enable: true })
  return { db, service, home, workspace, src }
}

const value = (
  record: { config: { key: string; value: unknown; isSet: boolean }[] },
  key: string,
) => record.config.find((field) => field.key === key)

describe('a user-scope plugin’s state', () => {
  test('a userConfig value saved in one project is the value in every project', async () => {
    const { db, service } = await setup()
    await service.setConfig('u1', {
      name: 'cfg',
      projectId: 'p1',
      values: { api_url: 'https://a' },
    })
    for (const projectId of [null, 'p1', 'pdefault']) {
      const { plugins } = await service.listPlugins('u1', { projectId })
      expect(
        value(
          plugins.find((p) => p.name === 'cfg')!,
          'api_url',
        )?.value,
      ).toBe('https://a')
    }
    const rows = await db
      .selectFrom('capability_source')
      .select('project_id')
      .where('kind', '=', 'plugin')
      .where('name', '=', 'cfg')
      .execute()
    expect(rows.map((row) => row.project_id)).toEqual([''])
  })

  test('a sensitive value goes to the vault and reaches the plugin through the catalog', async () => {
    const held = new Map<string, string>()
    const vault: OptionVaultPort = {
      store: async (_u, key, secret) => void held.set(key, secret),
      resolve: async (_u, key) => held.get(key) ?? null,
      versions: async () => new Map([...held.keys()].map((key) => [key, 1])),
      remove: async (_u, key) => void held.delete(key),
    }
    observeOptionVault(vault)
    const { db, service, home } = await setup()
    const saved = await service.setConfig('u1', {
      name: 'cfg',
      values: { api_url: 'https://a', api_token: 'LC-CANARY' },
    })
    expect(value(saved, 'api_token')).toMatchObject({ value: null, isSet: true })
    const rows = await db.selectFrom('capability_source').select('config').execute()
    expect(JSON.stringify(rows)).not.toContain('LC-CANARY')

    const catalog = await buildPluginCatalog({
      repo: capabilityStores.sources(db, 'plugin'),
      availability: UNDECIDED,
      userId: 'u1',
      projectId: 'p1',
      cwd: null,
      homeDir: home,
    })
    expect(catalog.find('cfg', 'p1')?.state?.config).toEqual({
      api_url: 'https://a',
      api_token: 'LC-CANARY',
    })
  })

  test('a plugin cannot read another plugin’s secret by saving its handle', async () => {
    const held = new Map<string, string>()
    observeOptionVault({
      store: async (_u, key, secret) => void held.set(key, secret),
      resolve: async (_u, key) => held.get(key) ?? null,
      versions: async () => new Map([...held.keys()].map((key) => [key, 1])),
      remove: async (_u, key) => void held.delete(key),
    })
    const { service, home, src } = await setup()
    await service.setConfig('u1', { name: 'cfg', values: { api_token: 'CANARY-A' } })
    const srcB = join(src, '..', 'src-b')
    writePlugin(srcB, 'b')
    await service.install('u1', { source: srcB, projectId: null, enable: true })
    const handle = `secret:${[...held.keys()][0]}`
    const saved = await service.setConfig('u1', { name: 'b', values: { api_url: handle } })
    expect(JSON.stringify(saved)).not.toContain('CANARY-A')

    const catalog = await buildPluginCatalog({
      repo: capabilityStores.sources(db!, 'plugin'),
      availability: UNDECIDED,
      userId: 'u1',
      projectId: '',
      cwd: null,
      homeDir: home,
    })
    expect(JSON.stringify(catalog.find('b', '')?.state?.config ?? {})).not.toContain('CANARY-A')
  })

  test('boot moves plain-text secrets to the vault and folds an old per-project copy', async () => {
    const held = new Map<string, string>()
    const { db, service, home } = await setup()
    const repo = capabilityStores.sources(db, 'plugin')
    // What an older build left: the token in plain text, and a stale per-project copy.
    await repo.patchConfig('u1', '', 'cfg', { api_url: 'https://new', api_token: 'OLD-PLAIN' })
    await repo.patchConfig('u1', 'p1', 'cfg', { api_url: 'https://stale' })
    observeOptionVault({
      store: async (_u, key, secret) => void held.set(key, secret),
      resolve: async (_u, key) => held.get(key) ?? null,
      versions: async () => new Map([...held.keys()].map((key) => [key, 1])),
      remove: async (_u, key) => void held.delete(key),
    })

    expect(await service.reconcileStoredConfig('u1')).toBe(2)
    const rows = await db
      .selectFrom('capability_source')
      .select(['project_id', 'config'])
      .where('kind', '=', 'plugin')
      .execute()
    expect(rows.map((row) => row.project_id)).toEqual([''])
    expect(rows[0]!.config).not.toContain('OLD-PLAIN')
    expect([...held.values()]).toEqual(['OLD-PLAIN'])
    const catalog = await buildPluginCatalog({
      repo,
      availability: UNDECIDED,
      userId: 'u1',
      projectId: 'p1',
      cwd: null,
      homeDir: home,
    })
    expect(catalog.find('cfg', 'p1')?.state?.config).toEqual({
      api_url: 'https://new',
      api_token: 'OLD-PLAIN',
    })
    expect(await service.reconcileStoredConfig('u1')).toBe(0)
  })

  test('an install row a user-scope plugin folds from keeps no plain-text secret', async () => {
    const held = new Map<string, string>()
    const { db, service } = await setup()
    const repo = capabilityStores.sources(db, 'plugin')
    // A project install row (it records its source) from an older build, its token in plain text.
    await repo.patchConfig('u1', 'p1', 'cfg', { api_token: 'P1-PLAIN' })
    await db
      .updateTable('capability_source')
      .set({ source: '/old/src' })
      .where('project_id', '=', 'p1')
      .execute()
    observeOptionVault({
      store: async (_u, key, secret) => void held.set(key, secret),
      resolve: async (_u, key) => held.get(key) ?? null,
      versions: async () => new Map([...held.keys()].map((key) => [key, 1])),
      remove: async (_u, key) => void held.delete(key),
    })

    expect(await service.reconcileStoredConfig('u1')).toBe(1)
    const rows = await db.selectFrom('capability_source').select(['config']).execute()
    expect(rows.some((row) => row.config.includes('P1-PLAIN'))).toBe(false)
    expect([...held.values()]).toEqual(['P1-PLAIN'])
    expect(await service.reconcileStoredConfig('u1')).toBe(0)
  })

  test('an update from a chat of the Default project re-installs it for all chats', async () => {
    const { service, src, workspace } = await setup()
    writePlugin(src, 'cfg', '1.1.0')
    const updated = await service.update('u1', { name: 'cfg', projectId: 'pdefault' })
    expect(updated).toMatchObject({ version: '1.1.0', scope: 'global' })
    // From a project with a folder it is not copied into the project either.
    writePlugin(src, 'cfg', '1.2.0')
    expect(await service.update('u1', { name: 'cfg', projectId: 'p1' })).toMatchObject({
      version: '1.2.0',
      scope: 'global',
    })
    expect(existsSync(join(workspace, '.localix', 'plugins', 'cfg'))).toBe(false)
  })

  test('removing the last copy deletes ${CLAUDE_PLUGIN_DATA}; a copy left elsewhere keeps it', async () => {
    const { service, home, src } = await setup()
    const data = pluginDataDir('cfg', home)
    mkdirSync(data, { recursive: true })
    writeFileSync(join(data, 'state'), 'kept')
    await service.install('u1', { source: src, projectId: 'p1', enable: true })

    await service.remove('u1', { name: 'cfg', projectId: null })
    expect(existsSync(join(data, 'state'))).toBe(true)
    await service.remove('u1', { name: 'cfg', projectId: 'p1' })
    expect(existsSync(data)).toBe(false)
  })
})
