import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Kysely } from 'kysely'
import { tempDirPerTest } from '@localixai/testing'
import { capabilityStores } from '../../../bootstrap/capability-stores'
import { createDatabase } from '../../../db/connection'
import { migrateToLatest } from '../../../db/migrator'
import type { AppDatabase } from '../../../db/types'
import type { LoadedPluginAgent } from '../../plugins/loader-contract'
import { agentFolders } from '../catalog/scan'
import { createAgentBindings, type PluginAgentGroup } from './bindings'
import { GRACE_MS } from './plan'

const file = (name: string, body = `You are ${name}.`) =>
  `---\nname: ${name}\ndescription: ${name} agent\n---\n${body}`

describe('agent bindings', () => {
  const base = tempDirPerTest('agent-bindings-')
  let db: Kysely<AppDatabase>
  let clock = 1_000_000
  let plugins: PluginAgentGroup[] = []
  let counter = 0
  const user = () => join(base(), 'home', '.claude', 'agents')
  const put = async (path: string, text: string) => {
    await fs.mkdir(join(path, '..'), { recursive: true })
    await fs.writeFile(path, text)
  }
  const bindings = () =>
    createAgentBindings({
      db,
      stores: capabilityStores,
      folders: async () =>
        agentFolders({
          cwd: null,
          home: join(base(), 'home'),
          managedDir: join(base(), 'managed'),
        }),
      plugins: async () => plugins,
      now: () => clock,
      newId: () => `cc:test-${++counter}`,
    })
  const notices = async () =>
    (await db.selectFrom('change_events').selectAll().where('entity', '=', 'agent').execute()).map(
      (row) =>
        [
          row.op,
          JSON.parse(row.ref_json!) as { id: string; scope: string; agentId: string },
        ] as const,
    )
  const names = async (b: ReturnType<typeof bindings>) =>
    (await b.snapshot('u', '')).agents
      .filter((entry) => entry.agent.source === 'user')
      .map((entry) => [entry.agent.name, entry.id])
  const pluginAgent = (name: string): LoadedPluginAgent => ({
    pluginName: 'acme',
    name,
    fullName: `acme:${name}`,
    label: name,
    description: name,
    prompt: `You are ${name}.`,
  })

  beforeEach(async () => {
    db = createDatabase()
    await migrateToLatest(db)
    clock = 1_000_000
    plugins = []
    counter = 0
  })
  afterEach(() => db.destroy())

  test('a new file gets an id and its notice in the same write; a rescan changes nothing', async () => {
    await put(join(user(), 'a.md'), file('a'))
    const b = bindings()
    expect(await names(b)).toEqual([['a', 'cc:test-1']])
    expect(await notices()).toEqual([
      ['upserted', { id: 'a', scope: 'global', agentId: 'cc:test-1' }],
    ])
    expect(await names(b)).toEqual([['a', 'cc:test-1']])
    expect(await notices()).toHaveLength(1)
  })

  test('a new agent starts with the default policy, so it has no open-policy window', async () => {
    await put(join(user(), 'a.md'), file('a'))
    await bindings().snapshot('u', '')
    const rules = await capabilityStores.rules(db).read('u', 'cc:test-1')
    expect(rules.some((rule) => rule.action === 'tool:Bash')).toBe(true)
  })

  test('edit, rename by path, move and rename by body keep one identity', async () => {
    const b = bindings()
    await put(join(user(), 'a.md'), file('a'))
    await b.snapshot('u', '')
    await put(join(user(), 'a.md'), file('a', 'Changed.'))
    expect(await names(b)).toEqual([['a', 'cc:test-1']])
    await put(join(user(), 'a.md'), file('b', 'Changed.'))
    expect(await names(b)).toEqual([['b', 'cc:test-1']])
    await fs.mkdir(join(user(), 'sub'))
    await fs.rename(join(user(), 'a.md'), join(user(), 'sub', 'moved.md'))
    expect(await names(b)).toEqual([['b', 'cc:test-1']])
    await fs.rename(join(user(), 'sub', 'moved.md'), join(user(), 'c.md'))
    await put(join(user(), 'c.md'), file('c', 'Changed.'))
    expect(await names(b)).toEqual([['c', 'cc:test-1']])
    const ops = (await notices()).map(([op, ref]) => `${op}:${ref.id}:${ref.agentId}`)
    expect(ops).toContain('deleted:a:cc:test-1')
    expect(ops).toContain('upserted:b:cc:test-1')
    expect(ops).toContain('upserted:c:cc:test-1')
  })

  test('a vanished file is missing, back within the grace it keeps its id, past it it is purged', async () => {
    const b = bindings()
    await put(join(user(), 'a.md'), file('a'))
    await b.snapshot('u', '')
    await fs.rm(join(user(), 'a.md'))
    const gone = await b.snapshot('u', '')
    expect(gone.agents.some((entry) => entry.agent.name === 'a')).toBe(false)
    expect(gone.purgeDueAt).toBe(clock + GRACE_MS)
    clock += GRACE_MS - 1
    await put(join(user(), 'a.md'), file('a'))
    expect(await names(b)).toEqual([['a', 'cc:test-1']])
    await fs.rm(join(user(), 'a.md'))
    await b.snapshot('u', '')
    clock += GRACE_MS
    const purged = await b.snapshot('u', '')
    expect(purged.purgeDueAt).toBeNull()
    expect(
      await db.selectFrom('capability_source').selectAll().where('kind', '=', 'agent').execute(),
    ).toEqual([])
    expect((await notices()).at(-1)).toEqual([
      'deleted',
      { id: 'a', scope: 'global', agentId: 'cc:test-1' },
    ])
    await put(join(user(), 'a.md'), file('a'))
    expect(await names(b)).toEqual([['a', 'cc:test-2']])
  })

  test('a plugin that is off is not a deletion; an uninstalled one is purged at once', async () => {
    const b = bindings()
    plugins = [{ plugin: 'acme', projectId: '', enabled: true, agents: [pluginAgent('lead')] }]
    const first = await b.snapshot('u', '')
    expect(first.agents.find((entry) => entry.agent.fullName === 'acme:lead')?.id).toBe('cc:test-1')
    plugins = [{ plugin: 'acme', projectId: '', enabled: false, agents: [] }]
    const off = await b.snapshot('u', '')
    expect(off.agents.some((entry) => entry.agent.fullName === 'acme:lead')).toBe(false)
    expect((await notices()).filter(([op]) => op === 'deleted')).toEqual([])
    plugins = [{ plugin: 'acme', projectId: '', enabled: true, agents: [pluginAgent('lead')] }]
    const on = await b.snapshot('u', '')
    expect(on.agents.find((entry) => entry.agent.fullName === 'acme:lead')?.id).toBe('cc:test-1')
    plugins = []
    await b.snapshot('u', '')
    expect((await notices()).at(-1)).toEqual([
      'deleted',
      { id: 'acme:lead', scope: 'global', agentId: 'cc:test-1' },
    ])
  })

  test('built-in types have fixed ids and no row', async () => {
    const snapshot = await bindings().snapshot('u', '')
    expect(snapshot.agents.find((entry) => entry.agent.name === 'Explore')?.id).toBe(
      'builtin:Explore',
    )
    expect(
      await db.selectFrom('capability_source').selectAll().where('kind', '=', 'agent').execute(),
    ).toEqual([])
  })

  test('a row of the retired registry is dropped with its notice', async () => {
    await capabilityStores
      .sources(db, 'agent')
      .upsert('u', '', 'native:global:old', { source: 'local', config: { presetSeed: 1 } })
    await bindings().snapshot('u', '')
    expect(await notices()).toEqual([
      ['deleted', { id: '', scope: 'global', agentId: 'native:global:old' }],
    ])
  })
})
