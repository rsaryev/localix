import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createDatabase, destroyDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createPluginService } from './service'

const previousEnv = {
  bundled: process.env.LOCALIX_BUNDLED_PLUGINS_DIR,
  claudeConfig: process.env.CLAUDE_CONFIG_DIR,
}

let root: string
let db: ReturnType<typeof createDatabase>

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-ui-action-'))
  await Promise.all([
    mkdir(join(root, 'source'), { recursive: true }),
    mkdir(join(root, 'workspace'), { recursive: true }),
    mkdir(join(root, 'home'), { recursive: true }),
    mkdir(join(root, 'bundled'), { recursive: true }),
    mkdir(join(root, 'claude-config'), { recursive: true }),
  ])
  await writeFile(
    join(root, 'source', 'plugin.json'),
    JSON.stringify({
      name: 'ui-action-fixture',
      version: '1.0.0',
      apiVersion: 1,
      description: 'UI action authorization fixture',
      views: [{ id: 'dashboard', title: 'Dashboard', surface: 'rail', file: './dashboard.html' }],
    }),
  )
  await writeFile(join(root, 'source', 'dashboard.html'), '<p>Dashboard</p>')

  process.env.LOCALIX_BUNDLED_PLUGINS_DIR = join(root, 'bundled')
  process.env.CLAUDE_CONFIG_DIR = join(root, 'claude-config')
  db = createDatabase()
  await migrateToLatest(db)
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

describe('plugin UI action service boundary', () => {
  test('authorizes the exact enabled scope and binds host-owned request context', async () => {
    const calls: unknown[] = []
    const service = createPluginService({
      db,
      capabilityStores,
      homeDir: join(root, 'home'),
      resolveProjectCwd: async () => join(root, 'workspace'),
      resolveSessionCwd: async () => join(root, 'session-isolated'),
      invokeUiAction: async (input) => {
        calls.push(input)
        return { ok: true }
      },
    })
    await service.install('user-1', {
      source: join(root, 'source'),
      projectId: 'project-1',
      enable: true,
    })

    expect(
      await service.invokeUiAction('user-1', {
        pluginName: 'ui-action-fixture',
        projectId: 'project-1',
        viewId: 'dashboard',
        sessionId: 'session-1',
        action: 'load.dashboard',
        payload: { page: 2 },
      }),
    ).toEqual({ result: { ok: true } })
    expect(calls).toEqual([
      {
        pluginName: 'ui-action-fixture',
        action: 'load.dashboard',
        payload: { page: 2 },
        context: {
          userId: 'user-1',
          projectId: 'project-1',
          cwd: join(root, 'session-isolated'),
          sessionId: 'session-1',
          viewId: 'dashboard',
        },
      },
    ])

    await service.setEnabled('user-1', {
      name: 'ui-action-fixture',
      projectId: 'project-1',
      enabled: false,
    })
    expect(
      service.invokeUiAction('user-1', {
        pluginName: 'ui-action-fixture',
        projectId: 'project-1',
        viewId: 'dashboard',
        action: 'load.dashboard',
      }),
    ).rejects.toMatchObject({ code: 'plugin_not_enabled' })
    expect(calls).toHaveLength(1)
  })
})
