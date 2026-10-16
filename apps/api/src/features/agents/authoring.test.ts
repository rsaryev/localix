import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAgentsService } from './service'
import { agentRecordInputSchema } from './contracts'
import { copyAgentPolicy } from './create-native-agent'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { seedAgentPresets } from '../capabilities/seed-agent-presets'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-agent-authoring-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  const project = join(root, 'project')
  const other = join(root, 'other')
  await mkdir(project)
  await mkdir(other)
  await migrateToLatest(db)
  const service = createAgentsService({
    db,
    globalDir: join(root, 'agents'),
    resolveProjectCwd: async (_u, id) => (id === 'p' ? project : id === 'q' ? other : null),
  })
  const rules = createCapabilityRuleRepository(db)
  const sources = createCapabilitySourceRepository(db, 'agent')
  await seedAgentPresets(
    { listAgents: async (u) => (await service.listAgents(u)).map((a) => a.record), rules, sources },
    'u',
  )
  return { service, rules, sources }
}

const input = {
  handle: 'database-reviewer',
  description: 'Reviews migrations',
  instructions: 'Review compatibility and recovery.',
  leadershipPriority: -1,
}
const origin = {
  agentId: 'builtin:localix',
  sessionId: 'chat-1',
  operationId: 'reply-1:call-1',
  projectId: 'p',
}

describe('agent-authored persistent specialists', () => {
  test('one batch shares a policy snapshot, preserves successes and retries failed entries', async () => {
    const { service, rules } = await fixture()
    await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'occupied', projectId: 'p' }),
    )
    const team = [
      input,
      { ...input, handle: 'occupied', leadershipPriority: 1 },
      { ...input, handle: 'tester', leadershipPriority: -2 },
    ]
    const first = await service.createAgentsFromAgent('u', team, origin)
    expect(first.created.map((agent) => agent.record.handle)).toEqual([
      'database-reviewer',
      'tester',
    ])
    expect(first.created.map((agent) => agent.record.leadershipPriority)).toEqual([-1, -2])
    expect(first.errors).toMatchObject([{ index: 1, handle: 'occupied', code: 'agent_exists' }])
    const replay = await service.createAgentsFromAgent('u', team, origin)
    expect(replay.created.map((agent) => agent.record.id)).toEqual(
      first.created.map((agent) => agent.record.id),
    )
    const policies = await Promise.all(
      first.created.map((agent) => rules.read('u', agent.record.id)),
    )
    expect(policies[0]!.map((rule) => rule.effect)).toEqual(policies[1]!.map((rule) => rule.effect))
    await expect(
      service.createAgentsFromAgent('u', [...team].reverse(), origin),
    ).rejects.toMatchObject({ code: 'agent_creation_conflict' })
    await service.deleteAgent('u', 'occupied', 'p')
    const repaired = await service.createAgentsFromAgent('u', team, origin)
    expect(repaired.errors).toEqual([])
    expect(repaired.created[0]!.record.id).toBe(first.created[0]!.record.id)
    expect(repaired.created[2]!.record.id).toBe(first.created[1]!.record.id)
  })

  test('an invalid member or duplicate handle rejects the entire batch before publication', async () => {
    const { service } = await fixture()
    for (const team of [
      [input, { ...input, handle: 'second', leadershipPriority: 3 }],
      [input, input],
    ]) {
      await expect(service.createAgentsFromAgent('u', team, origin)).rejects.toThrow()
    }
    expect(
      (await service.listAgents('u', { projectId: 'p' })).map((agent) => agent.record.handle),
    ).toEqual(['localix'])
  })
  test('copies the creator’s ordered saved policy once and leaves run defaults unset', async () => {
    const { service, rules } = await fixture()
    const saved = [
      ...(await rules.read('u', origin.agentId)),
      { action: 'tool:write', resource: '*', effect: 'deny' as const },
      { action: 'invocation:automation', resource: origin.agentId, effect: 'deny' as const },
    ]
    await rules.replace('u', origin.agentId, saved)
    const created = await service.createAgentFromAgent('u', input, origin)
    expect(created.scope).toBe('project')
    expect(created.projectId).toBe('p')
    expect(created.record.leadershipPriority).toBe(-1)
    expect(created.record.modelPreference).toBeUndefined()
    expect(created.record.context).toBeUndefined()
    expect(created.record.limits).toBeUndefined()
    expect(created.invocations.automation).toBe('deny')
    const inherited = copyAgentPolicy(saved, origin.agentId, created.record.id)
    expect(await rules.read('u', created.record.id)).toEqual([
      ...inherited,
      { action: `agent:${created.record.id}`, resource: '*', effect: 'allow' },
    ])
    await rules.replace('u', origin.agentId, [{ action: 'tool:*', resource: '*', effect: 'allow' }])
    expect(await rules.read('u', created.record.id)).toEqual([
      ...inherited,
      { action: `agent:${created.record.id}`, resource: '*', effect: 'allow' },
    ])
    expect(await service.getAgent('u', created.record.id)).toBeNull()
  })

  test('concurrent delivery creates one identity; replay follows a renamed definition', async () => {
    const { service, sources } = await fixture()
    const [a, b] = await Promise.all([
      service.createAgentFromAgent('u', input, origin),
      service.createAgentFromAgent('u', input, origin),
    ])
    expect(a.record.id).toBe(b.record.id)
    await service.updateAgent(
      'u',
      a.record.id,
      agentRecordInputSchema.parse({ ...input, handle: 'migration-reviewer' }),
      'p',
    )
    expect((await service.createAgentFromAgent('u', input, origin)).record.handle).toBe(
      'migration-reviewer',
    )
    expect((await sources.get('u', 'p', a.record.id))?.config.agentCreation).toMatchObject(origin)
    await expect(
      service.createAgentFromAgent('u', { ...input, instructions: 'Changed' }, origin),
    ).rejects.toMatchObject({ code: 'agent_creation_conflict' })
    await expect(
      service.createAgentFromAgent(
        'u',
        { ...input, handle: 'migration-reviewer' },
        { ...origin, operationId: 'different' },
      ),
    ).rejects.toMatchObject({ code: 'agent_exists' })
  })

  test('a project sees installation agents, may shadow them, and edits them where they live', async () => {
    const { service } = await fixture()
    const qa = await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'qa' }),
    )
    // Found by handle from a project, as a mention or the agents tool resolves it.
    expect((await service.getAgent('u', 'qa', 'p'))?.record.id).toBe(qa.record.id)
    expect((await service.selectEnabledAgent('u', 'qa', 'p'))?.id).toBe(qa.record.id)
    // An edit made from the project lands on the installation's definition.
    await service.updateAgent('u', 'qa', { ...input, handle: 'qa', description: 'Edited.' }, 'p')
    expect((await service.getAgent('u', 'qa', null))?.record.description).toBe('Edited.')
    // A project's own `qa` takes its place there, and only there.
    const own = await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'qa', projectId: 'p' }),
    )
    expect((await service.getAgent('u', 'qa', 'p'))?.record.id).toBe(own.record.id)
    expect((await service.getAgent('u', 'qa', null))?.record.id).toBe(qa.record.id)
  })

  test('unavailable, foreign and out-of-scope creators cannot publish', async () => {
    const { service } = await fixture()
    const local = await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'local-creator' }),
    )
    await expect(
      service.createAgentFromAgent('foreign-user', input, {
        ...origin,
        projectId: null,
        agentId: local.record.id,
      }),
    ).rejects.toMatchObject({ code: 'agent_creator_unavailable' })
    // Another project's agent is out of scope here; an installation agent is not (it is listed
    // in every project).
    const otherProject = await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'other-creator', projectId: 'q' }),
    )
    await expect(
      service.createAgentFromAgent('u', input, { ...origin, agentId: otherProject.record.id }),
    ).rejects.toMatchObject({ code: 'agent_creator_unavailable' })
    const projectCreator = await service.createAgent(
      'u',
      agentRecordInputSchema.parse({ ...input, handle: 'creator', projectId: 'p' }),
    )
    await service.setAgentEnabled('u', projectCreator.record.id, false, 'p')
    await expect(
      service.createAgentFromAgent('u', input, { ...origin, agentId: projectCreator.record.id }),
    ).rejects.toMatchObject({
      code: 'agent_creator_unavailable',
    })
    expect(
      (await service.listAgents('u', { projectId: 'p' })).some(
        (a) => a.record.handle === input.handle,
      ),
    ).toBe(false)
  })

  test('host validates injected settings before any publication and missing projects do not fall back', async () => {
    const { service } = await fixture()
    for (const field of ['permissions', 'role', 'projectId', 'enabled', 'modelPreference']) {
      await expect(
        service.createAgentFromAgent('u', { ...input, [field]: 'injected' }, origin),
      ).rejects.toThrow()
    }
    await expect(
      service.createAgentFromAgent('u', input, { ...origin, projectId: 'missing' }),
    ).rejects.toMatchObject({ code: 'agent_creator_unavailable' })
    expect((await service.listAgents('u')).some((a) => a.record.handle === input.handle)).toBe(
      false,
    )
  })
})
