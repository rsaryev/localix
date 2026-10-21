import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'
import { readAvailability } from '../capabilities/availability'

const previousEnv = {
  bundled: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  claudeConfig: process.env.CLAUDE_CONFIG_DIR,
}

let root: string
let sourceDir: string
let workspaceDir: string
let db: ReturnType<typeof createDatabase>
let service: ReturnType<typeof createPluginService>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-update-rollback-'))
  sourceDir = join(root, 'source', 'sample')
  workspaceDir = join(root, 'workspace')
  const homeDir = join(root, 'home')
  const bundledDir = join(root, 'bundled')
  const claudeConfigDir = join(root, 'claude-config')
  await Promise.all([
    mkdir(sourceDir, { recursive: true }),
    mkdir(workspaceDir, { recursive: true }),
    mkdir(homeDir, { recursive: true }),
    mkdir(bundledDir, { recursive: true }),
    mkdir(claudeConfigDir, { recursive: true }),
  ])

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
    const envKey = key === 'bundled' ? 'LOCALIX_BUNDLED_PLUGINS_DIR' : 'CLAUDE_CONFIG_DIR'
    if (value === undefined) delete process.env[envKey]
    else process.env[envKey] = value
  }
})

describe('plugin update rollback', () => {
  test('an invalid first installation publishes neither a tree nor a source row', async () => {
    const rows = await db.selectFrom('capability_source').selectAll().execute()
    const invalidSource = join(root, 'invalid-first')
    await mkdir(invalidSource)
    await writeFile(
      join(invalidSource, 'plugin.json'),
      JSON.stringify({ name: 'invalid-first', apiVersion: 'invalid' }),
    )
    await expect(
      service.install('u1', { source: invalidSource, projectId: 'project-1', enable: false }),
    ).rejects.toThrow()
    expect(await readdir(join(workspaceDir, '.localix', 'plugins'))).toEqual([])
    expect(await db.selectFrom('capability_source').selectAll().execute()).toEqual(rows)
  })

  test('direct replacement rejects an invalid manifest before changing the installed tree', async () => {
    const replacementSource = join(root, 'replacement')
    await mkdir(replacementSource)
    const original = JSON.stringify({ name: 'replacement', version: '1.0.0', apiVersion: 1 })
    await writeFile(join(replacementSource, 'plugin.json'), original)
    const input = { source: replacementSource, projectId: 'project-1', enable: false }
    await service.install('u1', input)
    const rows = await db.selectFrom('capability_source').selectAll().execute()
    await writeFile(
      join(replacementSource, 'plugin.json'),
      JSON.stringify({ name: 'replacement', apiVersion: 'invalid' }),
    )
    await expect(service.install('u1', input, { replace: true })).rejects.toThrow()
    const installRoot = join(workspaceDir, '.localix', 'plugins')
    expect(await readFile(join(installRoot, 'replacement', 'plugin.json'), 'utf8')).toBe(original)
    expect(await readdir(installRoot)).toEqual(['replacement'])
    expect(await db.selectFrom('capability_source').selectAll().execute()).toEqual(rows)
  })

  test('restores the last working tree when the replacement manifest is invalid', async () => {
    const originalManifest = JSON.stringify({
      name: 'sample',
      version: '1.0.0',
      apiVersion: 1,
      description: 'last known-good version',
    })
    await writeFile(join(sourceDir, 'plugin.json'), originalManifest)
    await service.install('u1', {
      source: sourceDir,
      projectId: 'project-1',
      enable: false,
    })

    await writeFile(join(sourceDir, 'plugin.json'), '{ invalid json')
    let updateError: unknown
    try {
      await service.update('u1', { name: 'sample', projectId: 'project-1' })
    } catch (error) {
      updateError = error
    }
    expect(updateError).toBeInstanceOf(Error)

    const installRoot = join(workspaceDir, '.localix', 'plugins')
    expect(await readFile(join(installRoot, 'sample', 'plugin.json'), 'utf8')).toBe(
      originalManifest,
    )
    expect((await readdir(installRoot)).some((name) => name.startsWith('.update-sample-'))).toBe(
      false,
    )
  })

  test('updating files retains the existing availability rules and their revision', async () => {
    const directory = join(root, 'policy-preserved')
    await mkdir(directory)
    await writeFile(
      join(directory, 'plugin.json'),
      JSON.stringify({ name: 'policy-preserved', version: '1.0.0' }),
    )
    await service.install('u1', { source: directory, projectId: 'project-1', enable: false })
    const rules = await db.selectFrom('capability_rule').selectAll().execute()
    const revisions = await db.selectFrom('capability_policy_revision').selectAll().execute()
    await writeFile(
      join(directory, 'plugin.json'),
      JSON.stringify({ name: 'policy-preserved', version: '2.0.0' }),
    )
    const updated = await service.update('u1', { name: 'policy-preserved', projectId: 'project-1' })
    expect(updated.version).toBe('2.0.0')
    expect(updated.enabled).toBe(false)
    expect(await db.selectFrom('capability_rule').selectAll().execute()).toEqual(rules)
    expect(await db.selectFrom('capability_policy_revision').selectAll().execute()).toEqual(
      revisions,
    )
  })

  test('agent-specific enable cascades stay in the agent scope and return that effective state', async () => {
    for (const name of ['scoped-helper', 'scoped-parent']) {
      const directory = join(root, name)
      await mkdir(directory)
      await writeFile(
        join(directory, 'plugin.json'),
        JSON.stringify({
          name,
          ...(name === 'scoped-parent' ? { dependencies: ['scoped-helper'] } : {}),
        }),
      )
      await service.install('u1', { source: directory, projectId: 'project-1' })
    }
    const agentId = 'builtin:localix'
    const result = await service.setEnabled('u1', {
      name: 'scoped-parent',
      projectId: 'project-1',
      agentId,
      enabled: true,
    })
    expect(result.enabled).toBe(true)
    // The switch and the dependency it pulled in both land in the named agent's list, and
    // another agent is untouched — a dropped-in plugin still waits to be asked about there.
    const other = await readAvailability(db, { userId: 'u1', agentId: 'builtin:qa' })
    expect(other.effectFor('plugin', 'scoped-parent', 'untrusted')).toBe('ask')
    expect(other.effectFor('plugin', 'scoped-helper', 'untrusted')).toBe('ask')
    const agent = await readAvailability(db, { userId: 'u1', agentId })
    expect(agent.effectFor('plugin', 'scoped-parent', 'untrusted')).toBe('allow')
    expect(agent.effectFor('plugin', 'scoped-helper', 'untrusted')).toBe('allow')
  })

  test('a dependency switch failure rolls back the parent switch and policy revisions', async () => {
    for (const name of ['toggle-helper', 'toggle-parent']) {
      const directory = join(root, name)
      await mkdir(directory)
      await writeFile(
        join(directory, 'plugin.json'),
        JSON.stringify({
          name,
          ...(name === 'toggle-parent' ? { dependencies: ['toggle-helper'] } : {}),
        }),
      )
      await service.install('u1', { source: directory, projectId: 'project-1' })
    }
    const rules = await db.selectFrom('capability_rule').selectAll().execute()
    const revisions = await db.selectFrom('capability_policy_revision').selectAll().execute()
    await sql`CREATE TRIGGER reject_toggle_dependency BEFORE INSERT ON capability_rule
      WHEN NEW.action = 'plugin:toggle-helper' AND NEW.effect = 'allow'
      BEGIN SELECT RAISE(ABORT, 'toggle dependency rejected'); END`.execute(db)
    try {
      await expect(
        service.setEnabled('u1', {
          name: 'toggle-parent',
          projectId: 'project-1',
          enabled: true,
        }),
      ).rejects.toThrow('toggle dependency rejected')
      expect(await db.selectFrom('capability_rule').selectAll().execute()).toEqual(rules)
      expect(await db.selectFrom('capability_policy_revision').selectAll().execute()).toEqual(
        revisions,
      )
    } finally {
      await sql`DROP TRIGGER reject_toggle_dependency`.execute(db)
    }
  })
})
