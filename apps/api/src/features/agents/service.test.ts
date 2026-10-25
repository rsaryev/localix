import { capabilityStores } from '../../bootstrap/capability-stores'
import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createAgentsService } from './service'
import { agentRecordInputSchema } from './contracts'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createCapabilitySourceRepository } from '../capabilities/source-repository'
import { seedAgentPresets } from '../capabilities/seed-agent-presets'
import { resolveCapabilities } from '../capabilities/resolve'
import { createInvocationRegistry } from '../capabilities/invocation'
import { capabilityRevision } from '../capabilities/revision'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-agent-service-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  // Claude Code's folders, in a temp tree: the person's `~/.claude` and one project's `.claude`.
  const userClaude = join(root, 'home', '.claude')
  const projectClaude = join(root, 'project', '.claude')
  const globalDir = join(userClaude, 'agents')
  const projectDir = join(projectClaude, 'agents')
  await mkdir(projectDir, { recursive: true })
  await mkdir(globalDir, { recursive: true })
  const invocations = createInvocationRegistry()
  const service = createAgentsService({
    db,
    capabilityStores,
    invocations,
    folders: async (_user, project) => ({
      managed: join(root, 'managed', '.claude'),
      user: userClaude,
      project: project === 'p' ? [projectClaude] : project ? null : [],
    }),
  })
  const rules = createCapabilityRuleRepository(db)
  await seedAgentPresets(
    {
      listAgents: async (user) => (await service.listAgents(user)).map((entry) => entry.record),
      rules,
      sources: createCapabilitySourceRepository(db, 'agent'),
    },
    'u',
  )
  return { service, rules, globalDir, projectDir, invocations }
}
const input = (handle = 'reviewer', extra: Record<string, unknown> = {}) =>
  agentRecordInputSchema.parse({
    handle,
    description: 'Reviews',
    instructions: 'Review.',
    ...extra,
  })

describe('agents as Claude Code files', () => {
  test('run resolution refreshes definition and policy together and rejects revoked invocation', async () => {
    const { service, rules } = await fixture()
    const { record } = await service.createAgent('u', input())
    const initial = await service.resolveRunAgent('u', record.id, 'delegation')
    expect(initial.status).toBe('allowed')
    if (initial.status !== 'allowed') throw new Error('Expected an admitted agent')
    expect(initial.agent.definition.instructions).toBe('Review.')
    expect(initial.agent.capabilities.allows('tool', 'read')).toBe(true)
    await service.updateAgent('u', record.id, input('reviewer', { instructions: 'Changed.' }))
    const outer = await rules.read('u', record.id)
    await rules.replace('u', record.id, [
      ...outer,
      { action: 'tool:read', resource: '*', effect: 'deny' },
    ])
    const next = await service.resolveRunAgent('u', record.id, 'delegation')
    expect(next.status).toBe('allowed')
    if (next.status !== 'allowed') throw new Error('Expected an admitted agent')
    expect(next.agent.definition.instructions).toBe('Changed.')
    expect(next.agent.capabilities.allows('tool', 'read')).toBe(false)
    expect(initial.agent.definition.instructions).toBe('Review.')
    expect(initial.agent.capabilities.allows('tool', 'read')).toBe(true)
    for (const effect of ['deny', 'ask'] as const) {
      await rules.replace('u', record.id, [
        ...outer,
        { action: 'invocation:delegation', resource: record.id, effect },
      ])
      expect((await service.resolveRunAgent('u', record.id, 'delegation')).status).toBe(
        effect === 'ask' ? 'approval_unsupported' : 'policy_denied',
      )
    }
  })

  test('invocation listing and explanations follow the same fresh policy as resolution', async () => {
    const { service, rules } = await fixture()
    const { record } = await service.createAgent('u', input())
    const listed = async () =>
      (await service.listInvocableAgents('u', 'delegation')).some((a) => a.record.id === record.id)
    expect(await listed()).toBe(true)
    expect(await service.explainAgentAvailability('u', record.id, 'delegation')).toEqual({
      agentId: record.id,
      host: 'delegation',
      status: 'allowed',
    })
    const initial = await rules.read('u', record.id)
    for (const effect of ['deny', 'ask'] as const) {
      await rules.replace('u', record.id, [
        ...initial,
        { action: 'invocation:delegation', resource: record.id, effect },
      ])
      expect(await listed()).toBe(false)
      expect(await service.resolveInvocableAgent('u', record.id, 'delegation')).toBeNull()
      expect(
        (await service.listInvocableAgents('u', 'automation')).some(
          (a) => a.record.id === record.id,
        ),
      ).toBe(true)
      expect((await service.explainAgentAvailability('u', record.id, 'delegation')).status).toBe(
        effect === 'ask' ? 'approval_required' : 'policy_denied',
      )
    }
    expect((await service.explainAgentAvailability('u', record.handle, 'chat')).status).toBe(
      'agent_not_found',
    )
    // An installation agent is listed in every project, under the same policy.
    expect((await service.explainAgentAvailability('u', record.id, 'chat', 'p')).status).toBe(
      'allowed',
    )
    expect(await service.listInvocableAgents('u', 'unknown')).toEqual([])
    expect((await service.explainAgentAvailability('u', record.id, 'unknown')).status).toBe(
      'unknown_host',
    )
    await service.setAgentEnabled('u', record.id, false)
    expect((await service.explainAgentAvailability('u', record.id, 'chat')).status).toBe(
      'agent_disabled',
    )
  })

  // The rule write bumps the revision once; the composition root's announcement, made inside the
  // same tracked mutation, does not bump it again.
  test('switching an agent moves the capability revision once', async () => {
    const { service } = await fixture()
    const start = capabilityRevision()
    const { record } = await service.createAgent('u', input())
    expect(capabilityRevision()).toBeGreaterThan(start)
    const before = capabilityRevision()
    await service.setAgentEnabled('u', record.id, false)
    expect(capabilityRevision()).toBe(before + 1)
    expect((await service.getAgent('u', record.id))?.enabled).toBe(false)
  })

  test('host registration and unload are shared by catalog and launch admission', async () => {
    const { service, rules, invocations } = await fixture()
    const { record } = await service.createAgent('u', input())
    await rules.replace('u', record.id, [
      ...(await rules.read('u', record.id)),
      { action: 'invocation:extension.job', resource: record.id, effect: 'allow' },
    ])
    expect(await service.resolveInvocableAgent('u', record.id, 'extension.job')).toBeNull()
    const unload = invocations.register({
      id: 'extension.job',
      label: 'Extension job',
    })
    expect((await service.getAgent('u', record.id))?.invocations['extension.job']).toBe('allow')
    expect(await service.resolveInvocableAgent('u', record.id, 'extension.job')).toEqual(record)
    unload()
    expect((await service.getAgent('u', record.id))?.invocations['extension.job']).toBeUndefined()
    expect(await service.resolveInvocableAgent('u', record.id, 'extension.job')).toBeNull()
  })

  test('unattended invocation rechecks host policy independently of enabled state', async () => {
    const { service, rules } = await fixture()
    const { record } = await service.createAgent('u', input())
    const originalRules = await rules.read('u', record.id)
    expect(await service.resolveInvocableAgent('u', record.id, 'automation')).toEqual(record)
    expect(await service.resolveInvocableAgent('u', record.id, 'unregistered')).toBeNull()
    expect(await service.resolveInvocableAgent('u', record.id, 'automation', 'p')).toEqual(record)
    for (const effect of ['deny', 'ask'] as const) {
      await rules.replace('u', record.id, [
        ...originalRules,
        { action: 'invocation:automation', resource: record.id, effect },
      ])
      expect(await service.resolveEnabledAgent('u', record.id)).toEqual(record)
      expect(await service.resolveInvocableAgent('u', record.id, 'automation')).toBeNull()
      expect(await service.resolveInvocableAgent('u', record.id, 'chat')).toEqual(record)
    }
    await rules.replace('u', record.id, originalRules)
    expect(await service.resolveInvocableAgent('u', record.id, 'automation')).toEqual(record)
    await service.setAgentEnabled('u', record.id, false)
    expect(await service.resolveInvocableAgent('u', record.id, 'automation')).toBeNull()
  })

  test('an authored agent is a Claude Code file with an identity and its own policy', async () => {
    const { service, globalDir } = await fixture()
    const agent = await service.createAgent('u', input())
    expect(agent.record.id).toBeTruthy()
    expect(agent.record.id).not.toBe(agent.record.handle)
    expect(agent.enabled).toBe(true)
    expect(agent.invocations.chat).toBe('allow')
    expect(agent).toMatchObject({ source: 'user', editable: true })
    const saved = await readFile(join(globalDir, 'reviewer.md'), 'utf8')
    expect(saved).toContain('name: reviewer')
    expect(saved).toContain('description: Reviews')
    expect(saved.trim().endsWith('Review.')).toBe(true)
    expect(await readdir(globalDir)).toEqual(['reviewer.md'])
  })
  test('a file made outside Localix is adopted with an id; a project file waits to be allowed', async () => {
    const { service, globalDir, projectDir } = await fixture()
    const file = (name: string) =>
      `---
name: ${name}
description: Use when ${name}
---
Body of ${name}.
`
    await writeFile(join(globalDir, 'scribe.md'), file('scribe'))
    await writeFile(join(projectDir, 'local-helper.md'), file('local-helper'))
    const scribe = (await service.getAgent('u', 'scribe'))!
    expect(scribe).toMatchObject({ enabled: true, source: 'user' })
    expect(scribe.record.instructions).toBe('Body of scribe.')
    expect((await service.getAgent('u', 'scribe'))!.record.id).toBe(scribe.record.id)
    const helper = (await service.getAgent('u', 'local-helper', 'p'))!
    expect(helper).toMatchObject({ enabled: false, source: 'project' })
    expect(await service.resolveEnabledAgent('u', helper.record.id, 'p')).toBeNull()
    expect((await service.setAgentEnabled('u', helper.record.id, true, 'p')).enabled).toBe(true)
  })
  test('editing keeps the ID and the file; a rename moves the file and keeps the ID', async () => {
    const { service, globalDir } = await fixture()
    const original = await service.createAgent('u', input())
    const edited = await service.updateAgent(
      'u',
      original.record.id,
      input('reviewer', { instructions: 'Edited.' }),
    )
    expect(edited.record.id).toBe(original.record.id)
    expect(edited.record.instructions).toBe('Edited.')
    const renamed = await service.updateAgent('u', original.record.id, input('critic'))
    expect(renamed.record.id).toBe(original.record.id)
    expect(await readdir(globalDir)).toEqual(['critic.md'])
    expect((await service.getAgent('u', 'critic'))?.record.id).toBe(original.record.id)
    expect(await service.getAgent('u', 'reviewer')).toBeNull()
  })
  test('copying and recreating issue new identities; delete removes the file', async () => {
    const { service, globalDir } = await fixture()
    const original = await service.createAgent('u', input())
    const copied = await service.duplicateAgent('u', original.record.id, 'copy')
    expect(copied.record.id).not.toBe(original.record.id)
    expect(copied.record.instructions).toBe('Review.')
    await service.deleteAgent('u', original.record.id)
    expect(await readdir(globalDir)).toEqual(['copy.md'])
    expect(await service.resolveEnabledAgent('u', original.record.id)).toBeNull()
    const recreated = await service.createAgent('u', input())
    expect(recreated.record.id).not.toBe(original.record.id)
  })
  test('two concurrent creates cannot replace each other', async () => {
    const { service } = await fixture()
    const results = await Promise.allSettled([
      service.createAgent('u', input()),
      service.createAgent('u', input()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect((await service.listAgents('u')).filter((agent) => agent.editable)).toHaveLength(1)
  })
  test('an old identity never resolves to the agent that took its name', async () => {
    const { service } = await fixture()
    const original = await service.createAgent('u', input())
    await service.deleteAgent('u', original.record.id)
    const replacement = await service.createAgent('u', input())
    expect(replacement.record.id).not.toBe(original.record.id)
    expect(await service.resolveEnabledAgent('u', original.record.id)).toBeNull()
    expect(await service.selectEnabledAgent('u', original.record.id)).toBeNull()
    expect(await service.selectEnabledAgent('u', 'reviewer')).toEqual(replacement.record)
    expect(await service.resolveEnabledAgent('u', 'localix')).toBeNull()
    expect((await service.resolveEnabledAgent('u', 'builtin:localix'))?.handle).toBe('localix')
  })
  test('a built-in agent is read-only: copy it to change it, and the main loop stays on', async () => {
    const { service } = await fixture()
    const main = (await service.getAgent('u', 'localix'))!
    expect(main).toMatchObject({ source: 'builtin', editable: false })
    await expect(service.deleteAgent('u', 'localix')).rejects.toThrow(/copy it to yours/i)
    await expect(
      service.updateAgent('u', 'localix', input('localix', { instructions: 'Edited.' })),
    ).rejects.toThrow(/copy it to yours/i)
    await expect(service.setAgentEnabled('u', 'localix', false)).rejects.toThrow(/switched off/i)
    const copy = await service.duplicateAgent('u', 'localix', 'lead')
    expect(copy).toMatchObject({ source: 'user', editable: true })
    expect(copy.record.id).not.toBe(main.record.id)
  })
  test('same handles in different places do not share capability rules', async () => {
    const { service, rules } = await fixture()
    const global = await service.createAgent('u', input())
    const project = await service.createAgent('u', input('reviewer', { projectId: 'p' }))
    expect(global.record.id).not.toBe(project.record.id)
    await rules.replace('u', global.record.id, [
      { action: 'tool:write', resource: '*', effect: 'deny' },
    ])
    const globalPolicy = await resolveCapabilities(rules, {
      userId: 'u',
      agentId: global.record.id,
    })
    const projectPolicy = await resolveCapabilities(rules, {
      userId: 'u',
      agentId: project.record.id,
    })
    expect(globalPolicy.allows('tool', 'write')).toBe(false)
    expect(projectPolicy.allows('tool', 'write')).toBe(true)
    expect(await service.getAgent('u', global.record.id, 'p')).toBeNull()
  })
  test('a project file named like a built-in shadows it only inside that project', async () => {
    const { service, projectDir } = await fixture()
    await writeFile(
      join(projectDir, 'Explore.md'),
      '---\nname: Explore\ndescription: Project explorer\n---\nLook closely.\n',
    )
    expect((await service.getAgent('u', 'Explore', 'p'))?.source).toBe('project')
    expect((await service.getAgent('u', 'Explore'))?.source).toBe('builtin')
  })
  test('a later invocation denial overrides the default the record was created with', async () => {
    // Creating an agent opens every host. Withdrawing one is a row appended to that agent's
    // own list — the last match about `invocation:chat` is the one that answers.
    const { service, rules } = await fixture()
    const agent = await service.createAgent('u', input())
    await rules.replace('u', agent.record.id, [
      ...(await rules.read('u', agent.record.id)),
      { action: 'invocation:chat', resource: agent.record.id, effect: 'deny' },
    ])
    const refreshed = (await service.getAgent('u', agent.record.id))!
    expect(refreshed.invocations.chat).toBe('deny')
    expect(refreshed.invocations.delegation).toBe('allow')
  })
  test('a new agent inherits the default agent’s rules, confirmations included', async () => {
    // It used to be created with nothing but one `invocation:<host> allow` per host — no
    // roster (which is also `localix`'s answer, so fine) and NO baseline confirmations. An
    // agent five seconds old could touch a path outside the workspace or run `rm -rf`
    // without asking, while every shipped role asked. Nobody chose that.
    const { service, rules } = await fixture()
    const agent = await service.createAgent('u', input())
    const own = await rules.read('u', agent.record.id)
    const guards = own.filter((rule) => rule.effect === 'ask')
    expect(guards.map((rule) => `${rule.action} ${rule.resource}`).sort()).toEqual([
      'tool:* outside-workspace',
      'tool:bash dangerous',
    ])
    // Identity rows are re-pointed: inheriting them verbatim would grant hosts to `localix`.
    for (const rule of own.filter((entry) => entry.action.startsWith('invocation:'))) {
      expect(rule.resource).toBe(agent.record.id)
    }
    expect(own.some((rule) => rule.action === 'invocation:chat' && rule.effect === 'allow')).toBe(
      true,
    )
  })

  test('unknown projects do not write into a fallback directory', async () => {
    const { service } = await fixture()
    await expect(
      service.createAgent('u', input('reviewer', { projectId: 'missing' })),
    ).rejects.toThrow(/directory/i)
  })
})
