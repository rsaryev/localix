import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'

const previousEnv = {
  LOCALIX_BUNDLED_PLUGINS_DIR: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  CLAUDE_CONFIG_DIR: process.env.CLAUDE_CONFIG_DIR,
}

let root: string
let homeDir: string
let workspaceDir: string
let bundledDir: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  )

async function writePlugin(dir: string, name: string) {
  await mkdir(join(dir, '.claude-plugin'), { recursive: true })
  await writeFile(
    join(dir, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', description: `${name} plugin` }),
  )
}

const names = async (projectId: string | null) =>
  (await service.listPlugins('u1', { projectId })).plugins.map((plugin) => plugin.name)

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-remove-'))
  homeDir = join(root, 'home')
  workspaceDir = join(root, 'workspace')
  bundledDir = join(root, 'bundled')
  const claudeConfigDir = join(root, 'claude-config')
  await Promise.all(
    [homeDir, workspaceDir, bundledDir, claudeConfigDir].map((dir) =>
      mkdir(dir, { recursive: true }),
    ),
  )
  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = bundledDir
  process.env.CLAUDE_CONFIG_DIR = claudeConfigDir

  db = createDatabase()
  await migrateToLatest(db)
  service = createPluginService({
    db,
    capabilityStores,
    homeDir,
    resolveProjectCwd: async () => workspaceDir,
  })
})

afterAll(async () => {
  await destroyDatabase(db)
  await rm(root, { recursive: true, force: true })
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('plugin remove', () => {
  test('a personal plugin loses its folder, its source row and its place in the list', async () => {
    const source = join(root, 'src', 'personal-tool')
    await writePlugin(source, 'personal-tool')
    const installed = await service.install('u1', { source, projectId: null, enable: true })
    expect(await exists(installed.dir)).toBe(true)
    expect(await names(null)).toContain('personal-tool')

    await service.remove('u1', { name: 'personal-tool', projectId: null })

    expect(await exists(installed.dir)).toBe(false)
    expect(await names(null)).not.toContain('personal-tool')
    const rows = await db.selectFrom('capability_source').selectAll().execute()
    expect(rows.some((row) => JSON.stringify(row).includes('personal-tool'))).toBe(false)
    // The source it was installed from is the person's, not ours to delete.
    expect(await exists(source)).toBe(true)
  })

  test('a project plugin is removed from that project only', async () => {
    const source = join(root, 'src', 'project-tool')
    await writePlugin(source, 'project-tool')
    const installed = await service.install('u1', { source, projectId: 'p1', enable: true })
    expect(installed.dir.startsWith(join(workspaceDir, '.localix', 'plugins'))).toBe(true)

    await service.remove('u1', { name: 'project-tool', projectId: 'p1' })

    expect(await exists(installed.dir)).toBe(false)
    expect(await names('p1')).not.toContain('project-tool')
    expect(await readdir(join(workspaceDir, '.localix', 'plugins'))).toEqual([])
  })

  test('a personal plugin whose folder is gone is removed from a project chat too', async () => {
    const source = join(root, 'src', 'vanished-tool')
    await writePlugin(source, 'vanished-tool')
    const installed = await service.install('u1', { source, projectId: null, enable: true })
    await rm(installed.dir, { recursive: true, force: true })

    await service.remove('u1', { name: 'vanished-tool', projectId: 'p1' })

    const rows = await db.selectFrom('capability_source').selectAll().execute()
    expect(rows.some((row) => JSON.stringify(row).includes('vanished-tool'))).toBe(false)
  })

  test('a name that is not installed is an error, not a removal', async () => {
    await expect(
      service.remove('u1', { name: 'never-installed', projectId: null }),
    ).rejects.toThrow('Plugin "never-installed" is not installed')
  })

  test('a Claude Code install is disabled here and left on disk for Claude Code', async () => {
    // Claude Code keeps its plugins in CLAUDE_CONFIG_DIR, which this suite sets.
    const installPath = join(
      process.env.CLAUDE_CONFIG_DIR!,
      'plugins',
      'cache',
      'mkt',
      'cc-tool',
      '1.0.0',
    )
    await mkdir(join(installPath, '.claude-plugin'), { recursive: true })
    await writeFile(
      join(installPath, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'cc-tool', description: 'cc-tool plugin' }),
    )
    await writeFile(
      join(process.env.CLAUDE_CONFIG_DIR!, 'plugins', 'installed_plugins.json'),
      JSON.stringify({
        version: 2,
        plugins: { 'cc-tool@mkt': [{ scope: 'user', installPath, version: '1.0.0' }] },
      }),
    )
    await service.setEnabled('u1', { name: 'cc-tool', projectId: null, enabled: true })

    const result = await service.remove('u1', { name: 'cc-tool', projectId: null })

    expect(result).toEqual({ warnings: [], claudeCodeInstall: 'cc-tool@mkt' })
    expect(await exists(installPath)).toBe(true)
    const listed = (await service.listPlugins('u1', { projectId: null })).plugins.find(
      (plugin) => plugin.name === 'cc-tool',
    )
    expect(listed?.enabled).toBe(false)
  })
})
