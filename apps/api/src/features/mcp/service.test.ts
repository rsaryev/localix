import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createMcpService, type McpService } from './service'

const tempDir = join(process.cwd(), 'tmp', 'mcp-service-tests')

async function freshService(): Promise<McpService> {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  return createMcpService({ db, now: () => '2026-06-30T00:00:00.000Z' })
}

describe('McpService import + toggle', () => {
  beforeAll(async () => {
    await mkdir(tempDir, { recursive: true })
  })
  afterAll(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  test('imports servers inert when defaultEnabled is false', async () => {
    const service = await freshService()
    const result = await service.importServers(
      'user-1',
      {
        mcpServers: {
          filesystem: {
            command: 'npx',
            args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
          },
          sentry: { url: 'https://mcp.sentry.dev/mcp' },
        },
        defaultEnabled: false,
      },
      null,
    )
    expect(result.errors).toHaveLength(0)
    expect(result.created).toHaveLength(2)
    expect(result.created.every((s) => !s.enabled)).toBe(true)
  })

  test('defaults to enabled when defaultEnabled is omitted', async () => {
    const service = await freshService()
    const result = await service.importServers(
      'user-1',
      { mcpServers: { filesystem: { command: 'npx', args: ['server'] } } },
      null,
    )
    expect(result.created[0]?.enabled).toBe(true)
  })

  test('setServerEnabled flips just the enabled flag, leaving config intact', async () => {
    const service = await freshService()
    const created = await service.createServer('user-1', {
      name: 'filesystem',
      description: 'fs server',
      transport: 'stdio',
      projectId: null,
      enabled: false,
      config: { command: ['npx', 'server'] },
    })
    expect(created.enabled).toBe(false)

    const enabled = await service.setServerEnabled('user-1', created.id, true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.id).toBe(created.id)
    expect(enabled.description).toBe('fs server')
    expect(enabled.config).toEqual({ command: ['npx', 'server'] })

    const disabled = await service.setServerEnabled('user-1', created.id, false)
    expect(disabled.enabled).toBe(false)
  })

  test('setServerEnabled 404s for an unknown id', async () => {
    const service = await freshService()
    expect(service.setServerEnabled('user-1', 'nope', true)).rejects.toThrow(/not found/i)
  })

  test("setServerEnabled is ownership-scoped (cannot toggle another user's server)", async () => {
    const service = await freshService()
    const created = await service.createServer('owner', {
      name: 'filesystem',
      description: '',
      transport: 'stdio',
      projectId: null,
      enabled: false,
      config: { command: ['npx', 'server'] },
    })
    expect(service.setServerEnabled('intruder', created.id, true)).rejects.toThrow(/not found/i)
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
