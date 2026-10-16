import { afterEach, expect, test } from 'bun:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'kysely'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createContributionKindRegistry, type ContributionInput } from '../ext/contribution-kinds'
import { createContributionStore } from '../ext/contribution-store'
import { agentContributionSchema } from '../agents/contribution'
import { createAgentsService } from '../agents/service'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createPluginService } from './service'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})
const agent = (instructions = 'Review changes.') => ({
  kind: 'agent',
  key: 'reviewer',
  value: {
    definition: { handle: 'reviewer', instructions },
    policyProposals: [{ action: 'tool:read', resource: '*', effect: 'allow' as const }],
  },
})

async function fixture() {
  const root = await fs.mkdtemp(join(tmpdir(), 'localix-native-plugin-'))
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
  const source = join(root, 'extension')
  const project = join(root, 'project')
  const globalDir = join(root, 'native-agents')
  await Promise.all([source, project, globalDir].map((directory) => fs.mkdir(directory)))
  const db = createDatabase()
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const kinds = createContributionKindRegistry()
  kinds.register('agent', agentContributionSchema)
  const service = createPluginService({
    db,
    homeDir: join(root, 'home'),
    contributionKinds: kinds,
    resolveProjectCwd: async () => project,
  })
  const agents = createAgentsService({ db, globalDir, resolveProjectCwd: async () => project })
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const store = createContributionStore(db, kinds)
  const write = (contributions: ContributionInput[]) =>
    fs.writeFile(
      join(source, 'plugin.json'),
      JSON.stringify({
        name: 'extension',
        apiVersion: 1,
        contributions,
      }),
    )
  const install = () =>
    service.install('u', { source, projectId: 'p', enable: true }, { replace: true })
  const current = async () => {
    const owner = await sources.get('u', 'p', 'extension')
    return owner ? store.getCurrent('u', owner.id) : null
  }
  return { db, source, project, service, agents, sources, store, write, install, current }
}

test('installation registers native agents in the live catalog without applying their proposed authority', async () => {
  const f = await fixture()
  await f.write([agent()])
  await f.install()
  const registered = (await f.current())!.contributions[0]!
  expect(await f.agents.getAgent('u', registered.id, 'p')).toMatchObject({
    record: { id: registered.id, handle: 'reviewer', instructions: 'Review changes.' },
    enabled: false,
    unavailableReason: 'policy_pending',
    registration: { key: 'reviewer', revision: 1 },
  })
  expect(await f.agents.resolveEnabledAgent('u', registered.id, 'p')).toBeNull()
  expect(await f.agents.getAgent('other', registered.id, 'p')).toBeNull()
  expect(await f.agents.getAgent('u', registered.id, 'other-project')).toBeNull()
  const review = await f.agents.registrationPolicy.review('u', 'p', registered.id)
  expect(review.currentRules).toEqual([])
  expect(review.proposedRules).toEqual(agent().value.policyProposals)
  await f.agents.setAgentEnabled('u', registered.id, true, 'p')
  // Switching the agent on is a write into the same list, so the publication has to quote the
  // revision as it stands AFTER it — which is the conflict check doing its job.
  const afterEnable = await f.agents.registrationPolicy.review('u', 'p', registered.id)
  await f.agents.registrationPolicy.publish('u', 'p', registered.id, {
    expectedRegistrationRevision: review.registrationRevision,
    expectedPolicyRevision: afterEnable.policyRevision,
    rules: [
      ...review.proposedRules,
      { action: 'invocation:chat', resource: registered.id, effect: 'allow' },
    ],
  })
  expect(await f.agents.resolveEnabledAgent('u', registered.id, 'p')).toMatchObject({
    id: registered.id,
    instructions: 'Review changes.',
  })
})

test('updates retain registration identity; removing and reintroducing a contribution creates a new identity', async () => {
  const f = await fixture()
  await f.write([agent()])
  await f.install()
  const first = (await f.current())!.contributions[0]!
  await f.write([agent('Review the new behavior.')])
  await f.service.update('u', { name: 'extension', projectId: 'p' })
  expect((await f.current())!.contributions[0]).toMatchObject({ id: first.id, revision: 2 })
  expect(await f.agents.getAgent('u', first.id, 'p')).toMatchObject({
    record: { instructions: 'Review the new behavior.' },
  })
  await f.write([])
  await f.install()
  expect(await f.agents.getAgent('u', first.id, 'p')).toBeNull()
  expect(await f.store.getHistory('u', first.id)).toMatchObject({ archived: true })
  await f.write([agent()])
  await f.install()
  expect((await f.current())!.contributions[0]!.id).not.toBe(first.id)
})

test('unknown kinds and foreign fields in native agent values reject replacement before publication', async () => {
  const f = await fixture()
  await f.write([agent()])
  await f.install()
  const previous = await f.current()
  const installedManifest = join(f.project, '.localix', 'plugins', 'extension', 'plugin.json')
  const previousFile = await fs.readFile(installedManifest, 'utf8')
  for (const invalid of [
    { kind: 'unknown', key: 'unknown', value: {} },
    {
      ...agent(),
      value: {
        ...agent().value,
        definition: { handle: 'reviewer', instructions: 'Review.', tools: ['bash'] },
      },
    },
  ]) {
    await f.write([invalid])
    await expect(f.install()).rejects.toThrow()
    expect(await f.current()).toEqual(previous)
    expect(await fs.readFile(installedManifest, 'utf8')).toBe(previousFile)
  }
})

test('failed contribution persistence rolls back source metadata, enable policy and installed files', async () => {
  const f = await fixture()
  await f.write([agent()])
  const rules = await f.db.selectFrom('capability_rule').selectAll().execute()
  await sql`CREATE TRIGGER reject_native_contribution BEFORE INSERT ON extension_contribution
    BEGIN SELECT RAISE(ABORT, 'contribution write rejected'); END`.execute(f.db)
  await expect(f.install()).rejects.toThrow('contribution write rejected')
  expect(await f.sources.get('u', 'p', 'extension')).toBeNull()
  expect(await f.db.selectFrom('capability_rule').selectAll().execute()).toEqual(rules)
  expect(await fs.readdir(join(f.project, '.localix', 'plugins'))).toEqual([])
})
