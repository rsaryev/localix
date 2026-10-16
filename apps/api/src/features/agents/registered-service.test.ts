import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'
import type { AppContext } from '../../app'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { createContributionStore } from '../ext/contribution-store'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { createAvailabilityWriter } from '../capabilities/availability'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { agentContributionSchema, type AgentContribution } from './contribution'
import { createAgentsService } from './service'
import { agentPolicy } from './policy'
import { createAgentsRoutes } from './routes'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})
const item = (handle = 'reviewer', policyProposals: AgentContribution['policyProposals'] = []) => ({
  kind: 'agent',
  key: handle,
  value: { definition: { handle, instructions: 'Review.' }, policyProposals },
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-registered-agent-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const globalDir = join(root, 'agents')
  await mkdir(globalDir)
  const db = createDatabase()
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const sources = createCapabilitySourceRepository(db, 'plugin')
  const source = await sources.upsert('u', '', 'extension', {})
  const kinds = createContributionKindRegistry()
  kinds.register('agent', agentContributionSchema)
  const store = createContributionStore(db, kinds)
  const service = createAgentsService({ db, globalDir, resolveProjectCwd: async () => root })
  const availability = createAvailabilityWriter(db)
  const rules = createCapabilityRuleRepository(db)
  // Every switch about a registered agent — its source, itself, the hosts it may run in —
  // is a row in that agent's own list, written in one go so the order is explicit.
  const enable = async (id: string, sourceName = 'extension') => {
    await rules.replace('u', id, [
      { action: `plugin:${sourceName}`, resource: '*', effect: 'allow' },
      { action: `agent:${id}`, resource: '*', effect: 'allow' },
      { action: 'invocation:chat', resource: id, effect: 'allow' },
    ])
  }
  return { db, globalDir, source, sources, store, service, enable, availability }
}

test('registered agents reach the live catalog and exact-ID resolver with independent gates', async () => {
  const { source, store, service, enable, availability } = await fixture()
  const published = await store.publish('u', source.id, 0, [item()])
  const id = published.contributions[0]!.id
  // No rule mentions the source, which now means "nobody has denied it" rather than "off":
  // the agent is still unavailable, because nothing has said it may be INVOKED either, and
  // that is the gate this registration has to pass on its own.
  expect(await service.getAgent('u', id)).toMatchObject({
    record: { id, handle: 'reviewer' },
    enabled: false,
    registration: { sourceId: source.id, key: 'reviewer', revision: 1 },
  })
  // Switching the agent on is now enough on its own: nothing denies its source, and silence
  // no longer means "off". What still has to be granted is the HOST — see `invocations` below.
  await service.setAgentEnabled('u', id, true)
  expect(await service.resolveEnabledAgent('u', id)).toMatchObject({ id })
  expect((await service.getAgent('u', id))?.invocations.chat).toBe('deny')
  await enable(id)
  expect(await service.resolveEnabledAgent('u', id)).toMatchObject({ id, instructions: 'Review.' })
  expect((await service.getAgent('u', id))?.invocations.chat).toBe('allow')
  expect(await service.resolveEnabledAgent('other', id)).toBeNull()
  expect(await service.resolveEnabledAgent('u', id, 'p')).toBeNull()
  await availability.set('u', id, 'plugin', [{ name: 'extension', enabled: false }])
  expect(await service.resolveEnabledAgent('u', id)).toBeNull()
  expect((await service.getAgent('u', id))?.invocations.chat).toBe('deny')
})

test('the native catalog also honors the agent scope when resolving availability', async () => {
  const { db, service } = await fixture()
  await createCapabilityRuleRepository(db).replace('u', 'builtin:localix', [
    { action: 'agent:builtin:localix', resource: '*', effect: 'deny' },
  ])
  expect((await service.getAgent('u', 'builtin:localix'))?.enabled).toBe(false)
  expect(await service.resolveEnabledAgent('u', 'builtin:localix')).toBeNull()
})

test('extension ownership prevents local edits, deletion and lossy copies', async () => {
  const { source, store, service, globalDir } = await fixture()
  const published = await store.publish('u', source.id, 0, [item()])
  const id = published.contributions[0]!.id
  const agent = (await service.getAgent('u', id))!
  expect(agentPolicy(agent)).toMatchObject({ editable: [], delete: false, duplicate: false })
  const { id: _id, ...definition } = agent.record
  await expect(service.updateAgent('u', id, definition)).rejects.toThrow('extension')
  await expect(service.deleteAgent('u', id)).rejects.toThrow()
  await expect(service.duplicateAgent('u', id, 'copy')).rejects.toThrow()
  expect(await readdir(globalDir)).toEqual([])
})

test('updates retain the registered ID and source removal immediately revokes resolution', async () => {
  const { source, sources, store, service, enable } = await fixture()
  const published = await store.publish('u', source.id, 0, [item()])
  const id = published.contributions[0]!.id
  await enable(id)
  const changed = item()
  changed.value.definition.instructions = 'Updated review.'
  await store.publish('u', source.id, 1, [changed])
  expect(await service.resolveEnabledAgent('u', id)).toMatchObject({
    id,
    instructions: 'Updated review.',
  })
  await sources.remove('u', '', 'extension')
  expect(await service.resolveEnabledAgent('u', id)).toBeNull()
  const replacement = await sources.upsert('u', '', 'extension', {})
  const reinstalled = await store.publish('u', replacement.id, 0, [item()])
  expect(reinstalled.contributions[0]!.id).not.toBe(id)
  expect(await service.resolveEnabledAgent('u', reinstalled.contributions[0]!.id)).toBeNull()
  expect(await store.getHistory('u', id)).toMatchObject({ archived: true })
})

test('ambiguous handles cannot select a different installation implicitly', async () => {
  const { source, sources, store, service, enable } = await fixture()
  const first = await store.publish('u', source.id, 0, [item()])
  const secondSource = await sources.upsert('u', '', 'another', {})
  const second = await store.publish('u', secondSource.id, 0, [item()])
  for (const [id, name] of [
    [first.contributions[0]!.id, 'extension'],
    [second.contributions[0]!.id, 'another'],
  ] as const)
    await enable(id, name)
  await expect(service.selectEnabledAgent('u', 'reviewer')).rejects.toThrow('by ID')
  await expect(service.getAgent('u', 'reviewer')).rejects.toThrow('by ID')
  expect(await service.resolveEnabledAgent('u', first.contributions[0]!.id)).toMatchObject({
    id: first.contributions[0]!.id,
  })
  expect(await service.resolveEnabledAgent('u', second.contributions[0]!.id)).toMatchObject({
    id: second.contributions[0]!.id,
  })
})

test('enabling a contribution cannot discard unpublished policy constraints', async () => {
  const { source, store, service, enable } = await fixture()
  const published = await store.publish('u', source.id, 0, [
    item('reviewer', [{ action: 'tool:*', resource: '*', effect: 'deny' }]),
  ])
  const id = published.contributions[0]!.id
  await enable(id)
  expect(await service.getAgent('u', id)).toMatchObject({
    enabled: false,
    unavailableReason: 'policy_pending',
  })
  expect(await service.resolveEnabledAgent('u', id)).toBeNull()
})

test('invalid registration diagnostics are owner-scoped and available without executing an agent', async () => {
  const { db, source, store, service } = await fixture()
  const published = await store.publish('u', source.id, 0, [item()])
  const id = published.contributions[0]!.id
  await db
    .updateTable('extension_contribution')
    .set({ payload: '{secret' })
    .where('id', '=', id)
    .execute()
  expect(await service.resolveEnabledAgent('u', id)).toBeNull()
  expect(await service.listRegistrationDiagnostics('u')).toEqual([
    { id, code: 'invalid_contribution' },
  ])
  expect(await service.listRegistrationDiagnostics('other')).toEqual([])
  const routes = new Hono<AppContext>()
    .use('*', async (c, next) => {
      c.set('userId', 'u')
      await next()
    })
    .route('/', createAgentsRoutes(service))
  const response = await routes.request('/registry/diagnostics')
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ diagnostics: [{ id, code: 'invalid_contribution' }] })
})
