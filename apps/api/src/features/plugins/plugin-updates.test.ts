import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { makeTempDir, removeDir } from '@localixai/testing'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { setMarketplaceAutoUpdate } from './marketplace-auto-update'
import { cachedVersionDir, readInstallRecords } from './plugin-cache'
import { createPluginService } from './service'

/**
 * Plugin updates as the background-activity center sees them: what is available is computed from
 * the marketplace listings without installing anything, an apply moves each job through
 * checking → downloading → installing → done (or failed, keeping the version before), and the
 * auto-update pass touches only marketplaces with auto-update on.
 */
const previous = process.env.CLAUDE_CONFIG_DIR
let root: string
let home: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

const source = (...parts: string[]) => join(root, 'market', 'plugins', 'tool', ...parts)
const setVersion = (version: string) =>
  writeFileSync(source('.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'tool', version }))
const installedVersion = async () => (await readInstallRecords(home))['tool@shop']?.version
const marketplacesRoot = () => join(home, '.localix', 'marketplaces')

beforeAll(async () => {
  root = makeTempDir('plugin-updates', {
    'market/.claude-plugin/marketplace.json': JSON.stringify({
      name: 'shop',
      owner: { name: 'Shop' },
      plugins: [{ name: 'tool', source: './plugins/tool' }],
    }),
    'market/plugins/tool/.claude-plugin/plugin.json': '{}',
    'market/plugins/tool/commands/run.md': '---\ndescription: Run\n---\nRun it.\n',
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
  await service.install('u1', { source: 'tool@shop', enable: true })
})

afterAll(async () => {
  await destroyDatabase(db)
  removeDir(root)
  if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR
  else process.env.CLAUDE_CONFIG_DIR = previous
})

describe('plugin updates', () => {
  test('nothing is available while the installed version is the listed one', async () => {
    const status = await service.updates.status('u1')
    expect(status.available).toEqual([])
    expect(status.jobs).toEqual([])
    expect(typeof status.lastCheckedAt).toBe('string')
  })

  test('a refresh finds a newer version without installing it', async () => {
    setVersion('2.0.0')
    const status = await service.updates.status('u1', { refresh: true })
    expect(status.available).toEqual([
      { id: 'tool@shop', name: 'tool', marketplace: 'shop', from: '1.0.0', to: '2.0.0' },
    ])
    expect(await installedVersion()).toBe('1.0.0')
    expect(existsSync(cachedVersionDir(home, 'shop', 'tool', '2.0.0'))).toBe(false)
  })

  test('a refresh of the listings from the marketplace commands is checked at once', async () => {
    setVersion('2.5.0')
    await service.refreshMarketplaces('u1')
    expect(service.updates.snapshot().available).toEqual([
      { id: 'tool@shop', name: 'tool', marketplace: 'shop', from: '1.0.0', to: '2.5.0' },
    ])
    setVersion('2.0.0')
    await service.updates.status('u1', { refresh: true })
  })

  test('an apply moves the job through its phases and installs the new version', async () => {
    const phases: string[] = []
    const off = service.updates.subscribe(() => {
      const phase = service.updates.snapshot().jobs.find((job) => job.id === 'tool@shop')?.phase
      if (phase && phases.at(-1) !== phase) phases.push(phase)
    })
    expect(await service.updates.apply('u1')).toEqual({ queued: ['tool@shop'] })
    await service.updates.idle()
    off()
    expect(phases).toEqual(['checking', 'downloading', 'installing', 'done'])
    expect(await installedVersion()).toBe('2.0.0')
    expect(existsSync(join(cachedVersionDir(home, 'shop', 'tool', '1.0.0'), '.orphaned_at'))).toBe(
      true,
    )
    expect((await service.updates.status('u1')).available).toEqual([])
  })

  test('a failed update says why and keeps the version before', async () => {
    setVersion('3.0.0')
    await service.updates.status('u1', { refresh: true })
    // The marketplace copy loses the plugin's folder between the check and the apply.
    rmSync(join(marketplacesRoot(), 'shop', 'plugins', 'tool'), { recursive: true })
    await service.updates.apply('u1', ['tool@shop'])
    await service.updates.idle()
    const job = (await service.updates.status('u1')).jobs.find((entry) => entry.id === 'tool@shop')
    expect(job?.phase).toBe('failed')
    expect(job?.error).toBeTruthy()
    expect(await installedVersion()).toBe('2.0.0')
  })

  test('the auto-update pass leaves a marketplace with auto-update off alone', async () => {
    const outcome = await service.updates.autoUpdatePass('u1', { env: {} })
    expect(outcome.updated).toEqual([])
    expect(await installedVersion()).toBe('2.0.0')
  })

  test('the pass is off under DISABLE_AUTOUPDATER unless FORCE_AUTOUPDATE_PLUGINS is set', async () => {
    await setMarketplaceAutoUpdate(marketplacesRoot(), 'shop', true)
    const off = await service.updates.autoUpdatePass('u1', { env: { DISABLE_AUTOUPDATER: '1' } })
    expect(off).toMatchObject({ skipped: true, updated: [] })
    expect(await installedVersion()).toBe('2.0.0')

    const forced = await service.updates.autoUpdatePass('u1', {
      env: { DISABLE_AUTOUPDATER: '1', FORCE_AUTOUPDATE_PLUGINS: '1' },
    })
    expect(forced.updated).toEqual(['tool@shop'])
    expect(await installedVersion()).toBe('3.0.0')
  })
})
