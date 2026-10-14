import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createContributionKindRegistry } from '../ext/contribution-kinds'
import { agentContributionSchema } from '../agents/contribution'
import { createAgentsService } from '../agents/service'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import { createPermissionGate } from '../agent-core/permission-gate'
import { NO_ROSTERS, projectCapabilities } from '../capabilities/resolve'
import { classifyBashCall } from '../agent-core/tools/bash/bash-call-class'
import type { AgentTool } from '@localixai/agent/agents'
import { loadManifest, type DiscoveredPlugin } from './discovery'
import { syncBundledContributions } from './sync-bundled-contributions'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose()
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'localix-bundled-agent-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const cwd = join(root, 'project')
  await mkdir(cwd)
  const kinds = createContributionKindRegistry()
  kinds.register('agent', agentContributionSchema)
  // A fixture, not a shipped plugin: no bundled plugin contributes an agent today, and the
  // mechanism must keep working for the next one that does.
  const manifest = await loadManifest(
    join(import.meta.dir, 'fixtures/agent-contribution'),
    'global',
    '',
  )
  const plugin: DiscoveredPlugin = { ...manifest, bundled: true }
  let discovered = [plugin]
  const sync = (projectId = 'p') =>
    syncBundledContributions({
      db,
      kinds,
      userId: 'u',
      projectId,
      plugins: discovered,
      now: () => '2026-01-01T00:00:00Z',
    })
  const agents = createAgentsService({
    db,
    globalDir: join(root, 'global'),
    resolveProjectCwd: async () => cwd,
    syncBundledContributions: async (_u, projectId) => sync(projectId),
  })
  const rules = createCapabilityRuleRepository(db)
  return {
    agents,
    rules,
    plugin,
    cwd,
    sync,
    discover: (plugins: DiscoveredPlugin[]) => {
      discovered = plugins
    },
  }
}

test('the bundled reviewer appears in the native directory with enforced read-only shell access', async () => {
  const f = await fixture()
  expect(f.plugin.error).toBeUndefined()
  expect(f.plugin.provides.agents).toEqual([`${f.plugin.manifest.name}:reviewer`])
  expect(f.plugin.agents).toEqual([])
  const reviewer = (await f.agents.listInvocableAgents('u', 'delegation', { projectId: 'p' })).find(
    (agent) => agent.record.handle === 'reviewer',
  )!
  expect(reviewer).toBeDefined()
  expect(reviewer.registration?.sourceName).toBe(f.plugin.manifest.name)
  expect(
    await f.agents.selectEnabledAgent('u', `${f.plugin.manifest.name}:reviewer`, 'p'),
  ).toMatchObject({
    id: reviewer.record.id,
  })
  expect(
    await f.agents.resolveEnabledAgent('u', `${f.plugin.manifest.name}:reviewer`, 'p'),
  ).toBeNull()
  const run = await f.agents.resolveRunAgent('u', reviewer.record.id, 'delegation', 'p')
  if (run.status !== 'allowed') throw new Error('Expected admitted reviewer')
  const projection = projectCapabilities(run.agent.capabilities, {
    ...NO_ROSTERS,
    tool: ['bash', 'read', 'write'],
  })
  expect(projection.denied.tool).toEqual(['write'])
  const gate = createPermissionGate({
    root: f.cwd,
    hostRoots: [],
    rules: projection.permissions,
    toolsByName: new Map([['bash', { name: 'bash', classify: classifyBashCall } as AgentTool]]),
  })
  expect(
    (await gate({ toolCallId: 'read', toolName: 'bash', input: { command: 'git diff --stat' } }))
      ?.block,
  ).toBeFalsy()
  expect(
    (
      await gate({
        toolCallId: 'write',
        toolName: 'bash',
        input: { command: 'echo code > app.ts' },
      })
    )?.block,
  ).toBe(true)
  const global = (await f.agents.listAgents('u')).find(
    (agent) => agent.record.handle === 'reviewer',
  )!
  expect(global.record.id).not.toBe(reviewer.record.id)
})

test('bundle refresh retains disabled choices; removing the bundle archives its registration', async () => {
  const f = await fixture()
  const reviewer = (await f.agents.listAgents('u', { projectId: 'p' })).find(
    (a) => a.record.handle === 'reviewer',
  )!
  await f.agents.setAgentEnabled('u', reviewer.record.id, false, 'p')
  const updated = structuredClone(f.plugin)
  const declaration = updated.manifest.contributions![0]!
  const contribution = agentContributionSchema.parse(declaration.value)
  contribution.definition.instructions = 'Updated review guidance.'
  declaration.value = contribution
  f.discover([updated])
  const after = await f.agents.getAgent('u', reviewer.record.id, 'p')
  expect(after?.record.instructions).toBe('Updated review guidance.')
  expect(after?.enabled).toBe(false)
  f.discover([])
  expect(await f.agents.getAgent('u', reviewer.record.id, 'p')).toBeNull()
})

test('a user-installed lookalike receives no automatic registration or authority', async () => {
  const f = await fixture()
  f.discover([{ ...f.plugin, bundled: false }])
  expect(
    (await f.agents.listAgents('u', { projectId: 'p' })).some(
      (a) => a.record.handle === 'reviewer',
    ),
  ).toBe(false)
})

test('a bundle policy update keeps custom restrictions and requires a new explicit review', async () => {
  const f = await fixture()
  const reviewer = (await f.agents.listAgents('u', { projectId: 'p' })).find(
    (a) => a.record.handle === 'reviewer',
  )!
  const review = await f.agents.registrationPolicy.review('u', 'p', reviewer.record.id)
  const custom = [
    ...review.currentRules,
    { action: 'tool:bash', resource: 'git log*', effect: 'deny' as const },
  ]
  await f.agents.registrationPolicy.publish('u', 'p', reviewer.record.id, {
    expectedRegistrationRevision: review.registrationRevision,
    expectedPolicyRevision: review.policyRevision,
    rules: custom,
  })
  const storedCustom = await f.rules.read('u', reviewer.record.id)
  const updated = structuredClone(f.plugin)
  const declaration = updated.manifest.contributions![0]!
  const contribution = agentContributionSchema.parse(declaration.value)
  contribution.policyProposals.push({ action: 'tool:write', resource: '*', effect: 'allow' })
  declaration.value = contribution
  f.discover([updated])
  expect(await f.agents.getAgent('u', reviewer.record.id, 'p')).toMatchObject({
    enabled: false,
    unavailableReason: 'policy_pending',
  })
  expect(await f.rules.read('u', reviewer.record.id)).toEqual(storedCustom)
})

test('disabling the parent source withdraws its registered reviewer immediately', async () => {
  const f = await fixture()
  const reviewer = (await f.agents.listAgents('u', { projectId: 'p' })).find(
    (a) => a.record.handle === 'reviewer',
  )!
  await f.rules.replace('u', 'builtin:localix', [
    { action: `plugin:${f.plugin.manifest.name}`, resource: '*', effect: 'deny' },
  ])
  expect(await f.agents.getAgent('u', reviewer.record.id, 'p')).toMatchObject({
    enabled: false,
    unavailableReason: 'source_disabled',
  })
  expect(
    (await f.agents.resolveRunAgent('u', reviewer.record.id, 'delegation', 'p')).status,
  ).not.toBe('allowed')
})

test('/review forks the speaking agent and contributes no agent of its own', async () => {
  const review = await loadManifest(
    join(import.meta.dir, '../../../../../plugins/review'),
    'global',
    '',
  )
  expect(review.provides.agents ?? []).toEqual([])
  expect(review.commands[0]?.prompt).toContain('call `fork`')
  expect(review.commands[0]?.prompt).not.toContain('`agents`')
  expect(review.commands[0]?.prompt).not.toContain('kanban_task_id')
})
