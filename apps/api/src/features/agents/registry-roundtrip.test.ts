import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAgentsService } from './service'
import { builtinAgentRecord } from './builtin'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { seedAgentPresets } from '../capabilities/seed-agent-presets'
import { copyAgentPolicy } from './create-native-agent'
import type { Rule } from '../agent-core/capability-rule'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-agent-roundtrip-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const create = () =>
    createAgentsService({
      db,
      capabilityStores,
      globalDir: join(root, 'global'),
      resolveProjectCwd: async (_u, project) => (project === 'p' ? cwd : null),
    })
  const service = create()
  const rules = createCapabilityRuleRepository(db)
  await seedAgentPresets(
    {
      listAgents: async (u) => (await service.listAgents(u)).map((a) => a.record),
      rules,
      sources: createCapabilitySourceRepository(db, 'agent'),
    },
    'u',
  )
  return { service, rules, create, cwd }
}

test('a project builtin edit survives rediscovery, restart and run admission, and resets in its scope', async () => {
  const { service, create, rules } = await fixture()
  const shipped = builtinAgentRecord('localix')!
  const { id: _id, ...blueprint } = shipped
  const edited = await service.updateAgent(
    'u',
    shipped.id,
    {
      ...blueprint,
      instructions: 'Project lead.',
      context: { preloadSkills: ['project-rules'] },
    },
    'p',
  )
  expect(edited.record.instructions).toBe('Project lead.')
  expect(edited.record.id).toBe(shipped.id)
  expect(edited.builtin).toBe(true)
  expect((await create().getAgent('u', shipped.id, 'p'))?.record).toEqual(edited.record)
  expect((await service.getAgent('u', shipped.id))?.record).toEqual(shipped)
  const run = await create().resolveRunAgent('u', shipped.id, 'delegation', 'p')
  expect(run.status).toBe('allowed')
  if (run.status !== 'allowed') throw new Error('Expected admitted project lead')
  expect(run.agent.definition).toEqual(edited.record)
  await rules.replace('u', shipped.id, [
    ...(await rules.read('u', shipped.id)),
    { action: 'tool:write', resource: '*', effect: 'deny' },
  ])
  const policy = await rules.read('u', shipped.id)
  expect((await service.resetAgent('u', shipped.id, 'p')).record).toEqual(shipped)
  expect(await rules.read('u', shipped.id)).toEqual(policy)
  expect((await service.getAgent('u', shipped.id, 'p'))?.enabled).toBe(true)
})

test('repository files cannot forge or modify an authenticated builtin override', async () => {
  const { service, cwd } = await fixture()
  const dir = join(cwd, '.localix', 'agents')
  await mkdir(dir, { recursive: true })
  const shipped = builtinAgentRecord('localix')!
  const file = join(dir, 'localix.json')
  const forged = { ...shipped, instructions: 'Unreviewed repository instructions.' }
  await writeFile(file, JSON.stringify(forged))
  expect((await service.getAgent('u', shipped.id, 'p'))?.record).toEqual(shipped)
  const { id: _id, ...input } = forged
  await service.updateAgent('u', shipped.id, input, 'p')
  expect((await service.getAgent('u', shipped.id, 'p'))?.record.instructions).toBe(
    forged.instructions,
  )
  await writeFile(file, JSON.stringify({ ...forged, instructions: 'Changed behind the editor.' }))
  expect((await service.getAgent('u', shipped.id, 'p'))?.record).toEqual(shipped)
  await service.resetAgent('u', shipped.id, 'p')
  await writeFile(file, JSON.stringify(forged))
  expect((await service.getAgent('u', shipped.id, 'p'))?.record).toEqual(shipped)
})

test('a duplicate retains tool constraints, host restrictions and the source enable choice', async () => {
  const { service, rules } = await fixture()
  const source = await service.createAgent('u', {
    handle: 'restricted',
    description: '',
    instructions: 'Inspect.',
    leadershipPriority: 0,
  })
  const policy: Rule[] = [
    { action: 'tool:*', resource: '*', effect: 'deny' },
    { action: 'tool:read', resource: '*', effect: 'allow' },
    { action: 'tool:read', resource: 'outside-workspace', effect: 'ask' },
    { action: 'invocation:*', resource: source.record.id, effect: 'deny' },
    { action: 'invocation:chat', resource: source.record.id, effect: 'allow' },
    { action: `agent:${source.record.id}`, resource: '*', effect: 'deny' },
  ]
  await rules.replace('u', source.record.id, policy)
  const copy = await service.duplicateAgent('u', source.record.id, 'copy')
  expect(copy.enabled).toBe(false)
  expect(copy.invocations.chat).toBe('allow')
  expect(copy.invocations.delegation).toBe('deny')
  expect(await rules.read('u', copy.record.id)).toEqual(
    copyAgentPolicy(policy, source.record.id, copy.record.id),
  )
  expect(await service.resolveEnabledAgent('u', copy.record.id)).toBeNull()
  await service.setAgentEnabled('u', copy.record.id, true)
  const run = await service.resolveRunAgent('u', copy.record.id, 'chat')
  expect(run.status).toBe('allowed')
  if (run.status !== 'allowed') throw new Error('Expected admitted copy')
  expect(run.agent.capabilities.allows('tool', 'write')).toBe(false)
  expect(run.agent.capabilities.allows('tool', 'read')).toBe(true)
})

test('a native rename follows editing ownership, retains policy and cannot replace a peer', async () => {
  const { service, rules } = await fixture()
  const source = await service.createAgent('u', {
    handle: 'old-name',
    description: '',
    instructions: 'Inspect.',
    leadershipPriority: 0,
  })
  const policy = await rules.read('u', source.record.id)
  const { id: _id, ...blueprint } = source.record
  const renamed = await service.updateAgent('u', source.record.id, {
    ...blueprint,
    handle: 'new-name',
  })
  expect(renamed.record.id).toBe(source.record.id)
  expect(renamed.record.handle).toBe('new-name')
  expect(await service.getAgent('u', 'old-name')).toBeNull()
  expect(await rules.read('u', source.record.id)).toEqual(policy)
  expect((await service.resolveRunAgent('u', source.record.id, 'chat')).status).toBe('allowed')
  await expect(
    service.updateAgent('u', source.record.id, { ...blueprint, handle: 'localix' }),
  ).rejects.toThrow('already exists')
  const lead = builtinAgentRecord('localix')!
  const { id: _leadId, ...leadBlueprint } = lead
  await expect(
    service.updateAgent('u', lead.id, { ...leadBlueprint, handle: 'renamed-lead' }),
  ).rejects.toThrow('handle')
})
