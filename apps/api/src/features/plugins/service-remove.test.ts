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
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'plugin.json'),
    JSON.stringify({ name, version: '1.0.0', apiVersion: 1, description: `${name} plugin` }),
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
  service = createPluginService({ db, homeDir, resolveProjectCwd: async () => workspaceDir })
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
})
