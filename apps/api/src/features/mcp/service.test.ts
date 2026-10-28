import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { observeOptionVault } from '../ext/option-vault'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMcpService, type McpService } from './service'

const tempDir = join(tmpdir(), `localix-mcp-service-tests-${process.pid}`)

async function freshService(): Promise<McpService> {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return createMcpService({ db, now: () => '2026-06-30T00:00:00.000Z' })
}

describe('McpService scopes and renames', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('updateServer renames IN PLACE — no duplicate row, same id', async () => {
    const service = await freshService()
    const created = await service.createServer('user-1', {
      name: 'old-name',
      description: '',
      transport: 'stdio',
      projectId: null,
      enabled: true,
      config: { command: ['npx', 'a'] },
    })
    const updated = await service.updateServer('user-1', created.id, {
      name: 'new-name',
      description: 'renamed',
      transport: 'stdio',
      projectId: null,
      enabled: true,
      config: { command: ['npx', 'b'] },
    })
    expect(updated.id).toBe(created.id)
    expect(updated.name).toBe('new-name')
    expect(updated.config).toEqual({ command: ['npx', 'b'] })
    const { servers } = await service.listServers('user-1', { projectId: null })
    expect(servers).toHaveLength(1)
  })

  test('updateServer 409s when the new name collides with another server in scope', async () => {
    const service = await freshService()
    await service.createServer('user-1', {
      name: 'taken',
      description: '',
      transport: 'stdio',
      projectId: null,
      enabled: true,
      config: { command: ['x'] },
    })
    const other = await service.createServer('user-1', {
      name: 'other',
      description: '',
      transport: 'stdio',
      projectId: null,
      enabled: true,
      config: { command: ['y'] },
    })
    expect(
      service.updateServer('user-1', other.id, {
        name: 'taken',
        description: '',
        transport: 'stdio',
        projectId: null,
        enabled: true,
        config: { command: ['y'] },
      }),
    ).rejects.toThrow(/already exists/i)
  })

  test('project and no-project servers with the same name remain isolated', async () => {
    const service = await freshService()
    const global = await service.createServer('user-1', {
      name: 'grep',
      description: 'global grep',
      transport: 'http',
      projectId: null,
      enabled: true,
      config: { url: 'https://global.example/mcp' },
    })
    const project = await service.createServer('user-1', {
      name: 'grep',
      description: 'project grep',
      transport: 'http',
      projectId: 'project-1',
      enabled: true,
      config: { url: 'https://project.example/mcp' },
    })

    const effective = await service.listForRuntime('user-1', 'project-1')
    expect(effective.filter((server) => server.name === 'grep')).toHaveLength(1)
    expect(effective.find((server) => server.name === 'grep')?.id).toBe(project.id)

    const globalOnly = await service.listForRuntime('user-1', '')
    expect(globalOnly.find((server) => server.name === 'grep')?.id).toBe(global.id)
  })
})

describe('McpService secrets', () => {
  test('a header never reaches the row, and a run still gets it', async () => {
    const items = new Map<string, string>()
    observeOptionVault({
      store: async (_user, key, value) => void items.set(key, value),
      resolve: async (_user, key) => items.get(key) ?? null,
      versions: async (_user, prefix) =>
        new Map([...items.keys()].filter((key) => key.startsWith(prefix)).map((key) => [key, 1])),
      remove: async (_user, key) => void items.delete(key),
    })
    try {
      const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
      await migrateToLatest(db)
      const service = createMcpService({ db })
      await service.createServer('user-1', {
        name: 'remote',
        description: '',
        transport: 'http',
        config: { url: 'https://x.example/mcp', headers: { Authorization: 'Bearer abc' } },
      })

      const row = await db
        .selectFrom('capability_source')
        .select('config')
        .executeTakeFirstOrThrow()
      expect(row.config).not.toContain('Bearer abc')
      const [server] = await service.listForRuntime('user-1', '')
      expect(server?.config.headers).toEqual({ Authorization: 'Bearer abc' })

      await service.deleteServer('user-1', server!.id)
      expect(items.size).toBe(0)
    } finally {
      observeOptionVault(undefined)
    }
  })
})
