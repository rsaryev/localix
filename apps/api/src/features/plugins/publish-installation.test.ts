import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterEach, expect, test } from 'bun:test'
import { DEFAULT_AGENT_ID } from '@localixai/agent/agents'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createAvailabilityWriter, readAvailability } from '../capabilities/availability'
import { publishPluginInstallation } from './publish-installation'
import { withPluginSource } from './install-helpers'
import { loadManifest } from './discovery'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture() {
  const db = createDatabase()
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-plugin-publication-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  const installRoot = join(root, 'installed')
  const sources = createCapabilitySourceRepository(db, 'plugin')
  for (const name of ['parent', 'helper']) {
    for (const [directory, version] of [
      [join(root, name), '2.0.0'],
      [join(installRoot, name), '1.0.0'],
    ]) {
      await fs.mkdir(join(directory!, '.claude-plugin'), { recursive: true })
      await fs.writeFile(
        join(directory!, '.claude-plugin', 'plugin.json'),
        JSON.stringify({
          name,
          version,
          ...(name === 'parent' ? { dependencies: ['helper'] } : {}),
        }),
      )
    }
    await sources.upsert('u', '', name, { source: `old-${name}`, config: { retained: true } })
  }
  await createAvailabilityWriter(db).set('u', DEFAULT_AGENT_ID, 'plugin', [
    { name: 'parent', enabled: false },
    { name: 'helper', enabled: false },
  ])
  const snapshot = async () => ({
    sources: await sources.listForScope('u', ''),
    rules: await db.selectFrom('capability_rule').selectAll().execute(),
    revisions: await db.selectFrom('capability_policy_revision').selectAll().execute(),
  })
  const before = await snapshot()
  const publish = (options: { enable?: boolean } = { enable: true }) =>
    withPluginSource({ source: join(root, 'parent'), installRoot }, (parent) =>
      publishPluginInstallation({
        db,
        stores: capabilityStores,
        userId: 'u',
        projectId: '',
        scope: 'global',
        installRoot,
        parent,
        source: 'new-parent',
        replace: true,
        enable: options.enable,
        now: () => 'new-time',
        prepare: async (directory) => {
          const plugin = await loadManifest(directory, 'global', '')
          if (plugin.error) throw new Error(plugin.error)
        },
        discover: async () => [await loadManifest(join(installRoot, 'helper'), 'global', '')],
        dependencies: {
          publication: () => ({
            trees: [{ source: join(root, 'helper'), name: 'helper', replace: true }],
            write: async (repo) => {
              await repo.upsert('u', '', 'helper', { source: 'new-helper' })
            },
          }),
        },
      }),
    )
  const version = async (name: string) =>
    JSON.parse(await fs.readFile(join(installRoot, name, '.claude-plugin', 'plugin.json'), 'utf8'))
      .version as string
  return { db, installRoot, sources, snapshot, before, publish, version }
}

test('failure writing the parent rolls back dependency metadata and both file trees', async () => {
  const f = await fixture()
  await sql`CREATE TRIGGER reject_parent BEFORE INSERT ON capability_source
    WHEN NEW.name = 'parent' BEGIN SELECT RAISE(ABORT, 'parent write rejected'); END`.execute(f.db)
  await expect(f.publish()).rejects.toThrow('parent write rejected')
  expect(await f.snapshot()).toEqual(f.before)
  expect(await f.version('parent')).toBe('1.0.0')
  expect(await f.version('helper')).toBe('1.0.0')
  expect((await fs.readdir(f.installRoot)).sort()).toEqual(['helper', 'parent'])
})

test('failure writing availability rolls back sources, policy revision and the complete file batch', async () => {
  const f = await fixture()
  await sql`CREATE TRIGGER reject_policy BEFORE INSERT ON capability_rule
    BEGIN SELECT RAISE(ABORT, 'policy write rejected'); END`.execute(f.db)
  await expect(f.publish()).rejects.toThrow('policy write rejected')
  expect(await f.snapshot()).toEqual(f.before)
  expect(await f.version('parent')).toBe('1.0.0')
  expect(await f.version('helper')).toBe('1.0.0')
})

test('successful publication retains source identities and commits the parent, dependencies and enable rule', async () => {
  const f = await fixture()
  const result = await f.publish()
  expect(result.plugin.manifest.version).toBe('2.0.0')
  expect(await f.version('parent')).toBe('2.0.0')
  expect(await f.version('helper')).toBe('2.0.0')
  for (const previous of f.before.sources)
    expect(await f.sources.get('u', '', previous.name)).toMatchObject({
      id: previous.id,
      config: previous.config,
      source: `new-${previous.name}`,
    })
  expect((await f.snapshot()).rules).not.toEqual(f.before.rules)
  expect((await fs.readdir(f.installRoot)).sort()).toEqual(['helper', 'parent'])
  const availability = await readAvailability(f.db, { userId: 'u', agentId: DEFAULT_AGENT_ID })
  expect(availability.effectFor('plugin', 'parent')).toBe('allow')
  expect(availability.effectFor('plugin', 'helper')).toBe('allow')
})

test('a dependency enable write failure rolls back the complete installation and every policy revision', async () => {
  const f = await fixture()
  await sql`CREATE TRIGGER reject_dependency_enable BEFORE INSERT ON capability_rule
    WHEN NEW.action = 'plugin:helper' AND NEW.effect = 'allow'
    BEGIN SELECT RAISE(ABORT, 'dependency enable rejected'); END`.execute(f.db)
  await expect(f.publish()).rejects.toThrow('dependency enable rejected')
  expect(await f.snapshot()).toEqual(f.before)
  expect(await f.version('parent')).toBe('1.0.0')
  expect(await f.version('helper')).toBe('1.0.0')
  expect((await fs.readdir(f.installRoot)).sort()).toEqual(['helper', 'parent'])
})

test('updating an enabled parent enables its dependencies without rewriting the parent switch', async () => {
  const f = await fixture()
  await createAvailabilityWriter(f.db).set('u', DEFAULT_AGENT_ID, 'plugin', [
    { name: 'parent', enabled: true },
  ])
  const before = await f.db
    .selectFrom('capability_policy_revision')
    .select('revision')
    .where('user_id', '=', 'u')
    .executeTakeFirstOrThrow()
  await f.publish({})
  const after = await f.db
    .selectFrom('capability_policy_revision')
    .select('revision')
    .where('user_id', '=', 'u')
    .executeTakeFirstOrThrow()
  expect(after.revision).toBe(before.revision + 1)
  const availability = await readAvailability(f.db, { userId: 'u', agentId: DEFAULT_AGENT_ID })
  expect(availability.effectFor('plugin', 'parent')).toBe('allow')
  expect(availability.effectFor('plugin', 'helper')).toBe('allow')
})

test('an explicit disabled installation does not activate dependencies', async () => {
  const f = await fixture()
  await f.publish({ enable: false })
  const availability = await readAvailability(f.db, { userId: 'u', agentId: DEFAULT_AGENT_ID })
  expect(availability.effectFor('plugin', 'parent')).toBe('deny')
  expect(availability.effectFor('plugin', 'helper')).toBe('deny')
})
