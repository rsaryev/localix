import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { StoreActor, StoreProvider } from '@localixai/store'

import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { observeOptionVault } from '../ext/option-vault'
import { createMcpRepository, type McpServerRecord } from './repository'
import { createMcpService, type McpService } from './service'
import { createMcpStoreProvider } from './store-provider'

const tempDir = join(process.cwd(), 'tmp', 'mcp-store-tests')
const actor: StoreActor = { userId: 'u1' }
const inProject: StoreActor & { projectId: string } = { userId: 'u1', projectId: 'p1' }

const fileRecord = (scope: string, name: string, config: Record<string, unknown>) =>
  ({
    id: `claude-code:${scope}:${name}`,
    userId: 'u1',
    projectId: '',
    name,
    description: '',
    transport: 'stdio',
    config,
    createdAt: '',
    updatedAt: '',
  }) satisfies McpServerRecord

/** The provider over a real database, with the connection probe and sign-in faked. */
async function setup(opts: { tools?: string[]; probeError?: string } = {}) {
  const db = createDatabase({ filename: join(tempDir, `${randomUUID()}.sqlite`) })
  await migrateToLatest(db)
  const real = createMcpService({ db })
  const switches: Array<{ name: string; enabled: boolean }> = []
  const off = new Set<string>()
  const service: McpService = {
    ...real,
    testServer: async () =>
      opts.probeError
        ? { ok: false, tools: [], error: opts.probeError }
        : { ok: true, tools: opts.tools ?? [], availableTools: opts.tools ?? [] },
    startServerOAuth: async () => ({ authorizationUrl: 'https://auth.example/authorize' }),
  }
  const provider: StoreProvider = createMcpStoreProvider({
    repo: createMcpRepository(db),
    service,
    availability: {
      reader: async () => ({ effectFor: (_kind, name) => (off.has(name) ? 'deny' : 'allow') }),
      set: async (_user, changes) => {
        for (const change of changes) {
          switches.push(change)
          if (change.enabled) off.delete(change.name)
          else off.add(change.name)
        }
      },
    },
    files: {
      user: () => [fileRecord('user', 'from-claude', { command: ['npx', 'tool'] })],
      project: (cwd) =>
        cwd === '/work/p1' ? [fileRecord('project', 'shared', { command: ['x'] })] : [],
    },
    projectCwd: async (_user, project) => (project === 'p1' ? '/work/p1' : null),
  })
  return { provider, service, switches, off }
}

const remote = {
  name: 'github',
  description: 'Issues and pull requests',
  transport: 'http' as const,
  config: { url: 'https://mcp.example.com', headers: { Authorization: 'Bearer abc' } },
}

describe('the MCP server Store provider', () => {
  beforeAll(() => mkdir(tempDir, { recursive: true }))
  afterAll(() => rm(tempDir, { recursive: true, force: true }))

  test('a hand-added server is on Yours, and an off switch shows', async () => {
    const { provider, service, off } = await setup()
    await service.createServer('u1', remote)
    off.add('github')

    const { listings } = await provider.listings(actor)
    const mine = listings.find((l) => l.ref.id === 'github')!
    expect(mine).toMatchObject({
      ref: { kind: 'mcp-server', id: 'github' },
      authored: 'user',
      configurable: true,
      summary: 'Issues and pull requests',
      installs: [{ scope: 'user', enabled: false }],
    })
  })

  test('what Claude Code keeps in its own files is listed, and cannot be configured or removed here', async () => {
    const { provider } = await setup()

    const listed = (await provider.listings(actor)).listings.find(
      (l) => l.ref.id === 'file:user:from-claude',
    )!
    expect(listed.authored).toBe('user')
    expect(listed.configurable).toBeUndefined()
    expect(await provider.config!(listed.ref.id, 'user', actor)).toBeNull()
    await expect(provider.remove(listed.ref.id, 'user', actor)).rejects.toThrow(/claude\.json/u)
    const detail = await provider.detail(listed.ref.id, actor)
    expect(detail.facts).toContainEqual({ label: 'Defined in', value: '~/.claude.json' })
  })

  test('a project keeps its servers apart from the person own, and its .mcp.json joins them', async () => {
    const { provider, service } = await setup()
    await service.createServer('u1', remote)
    await service.createServer('u1', { ...remote, name: 'db', projectId: 'p1' })

    const person = await provider.listings(inProject)
    expect(person.listings.map((l) => l.ref.id)).not.toContain('project:db')
    const project = await provider.projectListings!(inProject)
    expect(project.map((l) => [l.ref.id, l.authored])).toEqual([
      ['project:db', 'project'],
      ['file:project:shared', 'project'],
    ])
    expect(project[0]!.installs).toEqual([{ scope: 'project', enabled: true }])
  })

  describe('adding one', () => {
    test('offers a form, with the project as a place only inside a project', async () => {
      const { provider } = await setup()
      const alone = await provider.createFields!(actor)
      expect(alone.scopes).toEqual(['user'])
      expect(alone.noun).toBe('MCP server')
      expect(alone.fields.map((f) => f.key)).toEqual(
        expect.arrayContaining(['name', 'transport', 'command', 'url', 'env', 'headers']),
      )
      expect((await provider.createFields!(inProject)).scopes).toEqual(['user', 'project'])
    })

    test('makes a local server from a command line and says where to open it', async () => {
      const { provider, service } = await setup()
      const ref = await provider.create!(
        'user',
        { name: 'fs', transport: 'stdio', command: 'npx -y server "/my dir"', env: { K: 'v' } },
        actor,
      )
      expect(ref).toEqual({ kind: 'mcp-server', id: 'fs' })
      const [made] = await service.listForRuntime('u1', '')
      expect(made?.config).toMatchObject({
        command: ['npx', '-y', 'server', '/my dir'],
        env: { K: 'v' },
      })
    })

    test('keeps a project server in its project', async () => {
      const { provider, service } = await setup()
      const ref = await provider.create!(
        'project',
        { name: 'db', transport: 'http', url: 'https://db.example' },
        inProject,
      )
      expect(ref.id).toBe('project:db')
      expect(await service.listForRuntime('u1', 'p1')).toHaveLength(1)
      expect(await service.listForRuntime('u1', '')).toHaveLength(0)
    })

    test('refuses what could not connect, a taken name and a project that is not open', async () => {
      const { provider, service } = await setup()
      await expect(
        provider.create!('user', { name: 'x', transport: 'stdio' }, actor),
      ).rejects.toThrow(/command/u)
      await expect(
        provider.create!('user', { name: 'x', transport: 'http' }, actor),
      ).rejects.toThrow(/URL/u)
      await expect(
        provider.create!('user', { name: 'bad name', transport: 'http', url: 'https://x' }, actor),
      ).rejects.toThrow(/name/iu)
      await service.createServer('u1', remote)
      await expect(
        provider.create!('user', { name: 'github', transport: 'http', url: 'https://x' }, actor),
      ).rejects.toThrow(/already exists/u)
      await expect(
        provider.create!('project', { name: 'p', transport: 'http', url: 'https://x' }, actor),
      ).rejects.toThrow(/project/u)
    })
  })

  describe('settings', () => {
    test('shows what is set, and only says that a secret is', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', {
        ...remote,
        config: {
          ...remote.config,
          timeout: 30000,
          oauth: { clientId: 'cid', clientSecret: 'shh' },
        },
      })

      const config = (await provider.config!('github', 'user', actor))!
      expect(config.values).toMatchObject({
        description: 'Issues and pull requests',
        transport: 'http',
        url: 'https://mcp.example.com',
        timeout: 30000,
        oauthClientId: 'cid',
      })
      expect(config.set.sort()).toEqual(['headers', 'oauthClientSecret'])
      expect(JSON.stringify(config.values)).not.toMatch(/abc|shh/u)
      expect(config.actions?.map((a) => a.id)).toEqual(['test', 'sign-in', 'sign-out'])
    })

    test('a local server has a command and no sign-in', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', {
        name: 'fs',
        description: '',
        transport: 'stdio',
        config: { command: ['npx', '-y', 'my server'] },
      })
      const config = (await provider.config!('fs', 'user', actor))!
      expect(config.values.command).toBe("npx -y 'my server'")
      expect(config.actions?.map((a) => a.id)).toEqual(['test'])
    })

    test('saves the keys it is given, keeping the rest and a secret left out', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)

      await provider.setConfig!('github', 'user', { timeout: 60000, description: 'Code' }, actor)
      const [saved] = await service.listForRuntime('u1', '')
      expect(saved).toMatchObject({
        description: 'Code',
        config: { url: 'https://mcp.example.com', timeout: 60000 },
      })
      expect(saved?.config.headers).toEqual({ Authorization: 'Bearer abc' })

      await provider.setConfig!(
        'github',
        'user',
        { headers: { Authorization: 'Bearer new' } },
        actor,
      )
      expect((await service.listForRuntime('u1', ''))[0]?.config.headers).toEqual({
        Authorization: 'Bearer new',
      })
    })

    test('Listen as a channel is a switch on the page, kept when other settings are saved', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)

      const before = await provider.config!('github', 'user', actor)
      expect(before!.fields).toContainEqual(
        expect.objectContaining({ key: 'channel', label: 'Listen as a channel', type: 'boolean' }),
      )
      expect(before!.values.channel).toBe(false)

      await provider.setConfig!('github', 'user', { channel: true }, actor)
      expect((await service.listForRuntime('u1', ''))[0]?.config.channel).toBe(true)
      expect((await provider.config!('github', 'user', actor))!.values.channel).toBe(true)

      await provider.setConfig!('github', 'user', { timeout: 60000 }, actor)
      expect((await service.listForRuntime('u1', ''))[0]?.config.channel).toBe(true)

      await provider.setConfig!('github', 'user', { channel: false }, actor)
      expect((await service.listForRuntime('u1', ''))[0]?.config.channel).toBeUndefined()
    })

    test('refuses a change that leaves it unable to connect', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)
      await expect(
        provider.setConfig!('github', 'user', { transport: 'stdio' }, actor),
      ).rejects.toThrow(/command/u)
    })
  })

  describe('testing and tools', () => {
    test('says it connected, and then lists the tools to switch', async () => {
      const { provider, service, switches } = await setup({
        tools: ['create_issue', 'delete_repo'],
      })
      await service.createServer('u1', remote)
      expect(
        (await provider.config!('github', 'user', actor))!.fields.map((f) => f.key),
      ).not.toContain('tools')

      const result = await provider.runAction!('github', 'user', 'test', actor)
      expect(result).toEqual({ ok: true, message: 'Connected: 2 tools' })

      const config = (await provider.config!('github', 'user', actor))!
      const tools = config.fields.find((f) => f.key === 'tools')!
      expect(tools.type).toBe('multichoice')
      expect(tools.options?.map((o) => o.value)).toEqual(['create_issue', 'delete_repo'])
      expect(config.values.tools).toEqual(['create_issue', 'delete_repo'])

      await provider.setConfig!('github', 'user', { tools: ['create_issue'] }, actor)
      expect(switches).toEqual([
        { name: 'github/create_issue', enabled: true },
        { name: 'github/delete_repo', enabled: false },
      ])
      expect((await provider.config!('github', 'user', actor))!.values.tools).toEqual([
        'create_issue',
      ])
    })

    test('says why it could not connect', async () => {
      const { provider, service } = await setup({ probeError: 'connection refused' })
      await service.createServer('u1', remote)
      expect(await provider.runAction!('github', 'user', 'test', actor)).toEqual({
        ok: false,
        message: 'connection refused',
      })
    })

    test('signing in hands the browser the address to open', async () => {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)
      expect(await provider.runAction!('github', 'user', 'sign-in', actor)).toEqual({
        ok: true,
        message: 'Finish signing in in your browser',
        open: 'https://auth.example/authorize',
      })
      expect((await provider.runAction!('github', 'user', 'sign-out', actor)).ok).toBe(true)
    })
  })

  test('removing one forgets its secrets and its row', async () => {
    const items = new Map<string, string>()
    observeOptionVault({
      store: async (_user, key, value) => void items.set(key, value),
      resolve: async (_user, key) => items.get(key) ?? null,
      versions: async (_user, prefix) =>
        new Map([...items.keys()].filter((k) => k.startsWith(prefix)).map((k) => [k, 1])),
      remove: async (_user, key) => void items.delete(key),
    })
    try {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)
      expect(items.size).toBe(1)
      await provider.remove('github', 'user', actor)
      expect(items.size).toBe(0)
      expect((await provider.listings(actor)).listings.map((l) => l.ref.id)).not.toContain('github')
    } finally {
      observeOptionVault(undefined)
    }
  })

  test('a save does not erase a secret the vault cannot give back', async () => {
    const items = new Map<string, string>()
    let lost = false
    observeOptionVault({
      store: async (_user, key, value) => void items.set(key, value),
      resolve: async (_user, key) => items.get(key) ?? null,
      versions: async (_user, prefix) =>
        new Map(
          lost ? [] : [...items.keys()].filter((k) => k.startsWith(prefix)).map((k) => [k, 1]),
        ),
      remove: async (_user, key) => void items.delete(key),
    })
    try {
      const { provider, service } = await setup()
      await service.createServer('u1', remote)
      lost = true
      await expect(
        provider.setConfig!('github', 'user', { description: 'Code' }, actor),
      ).rejects.toThrow(/enter it again/u)
      expect(items.size).toBe(1)
    } finally {
      observeOptionVault(undefined)
    }
  })

  test('the switch works for a server of a file, by name', async () => {
    const { provider, switches } = await setup()
    await provider.setEnabled!('file:user:from-claude', 'user', false, actor)
    expect(switches).toEqual([{ name: 'from-claude', enabled: false }])
  })

  test('it is made here, not installed', async () => {
    const { provider } = await setup()
    await expect(provider.install('github', 'user', { plan: true }, actor)).rejects.toThrow(/Add/u)
  })
})
