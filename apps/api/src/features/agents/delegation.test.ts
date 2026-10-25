import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { capabilityStores } from '../../bootstrap/capability-stores'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import type { LoadedPluginAgent } from '../plugins/loader-contract'
import { createAgentsService } from './service'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

const pluginAgent = (plugin: string, name: string): LoadedPluginAgent => ({
  pluginName: plugin,
  name,
  fullName: `${plugin}:${name}`,
  label: name,
  description: `${name} from ${plugin}`,
  prompt: `You are ${name}.`,
})

async function fixture(plugins: Record<string, readonly string[]> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'localix-agent-delegation-'))
  cleanup.push(() => rm(root, { recursive: true, force: true }))
  const db = createDatabase({ filename: join(root, 'test.sqlite') })
  cleanup.push(() => db.destroy())
  await migrateToLatest(db)
  const userClaude = join(root, 'home', '.claude')
  const projectClaude = join(root, 'project', '.claude')
  await mkdir(join(userClaude, 'agents'), { recursive: true })
  await mkdir(join(projectClaude, 'agents'), { recursive: true })
  const service = createAgentsService({
    db,
    capabilityStores,
    folders: async (_user, project) => ({
      managed: join(root, 'managed', '.claude'),
      user: userClaude,
      project: project === 'p' ? [projectClaude] : project ? null : [],
    }),
    plugins: async () =>
      Object.entries(plugins).map(([plugin, names]) => ({
        plugin,
        projectId: '',
        enabled: true,
        agents: names.map((name) => pluginAgent(plugin, name)),
      })),
  })
  const file = (dir: string, name: string, front = '', body = `Body of ${name}.`) =>
    writeFile(
      join(dir, 'agents', `${name}.md`),
      `---\nname: ${name}\ndescription: Use for ${name}\n${front}---\n${body}\n`,
    )
  return {
    service,
    rules: createCapabilityRuleRepository(db),
    userFile: (name: string, front?: string) => file(userClaude, name, front),
    projectFile: (name: string, front?: string) => file(projectClaude, name, front),
  }
}

describe('resolving who a task goes to', () => {
  test('a built-in type is a catalog agent with its read-only ceiling', async () => {
    const t = await fixture()
    const target = await t.service.resolveDelegation('u', 'Explore')
    expect(target).toMatchObject({
      kind: 'agent',
      agent: { id: 'builtin:Explore', handle: 'Explore' },
      definition: { omitClaudeMd: true, disallowedTools: ['write', 'edit'] },
    })
  })

  test('general-purpose, its alias and a mention of either run as the delegator', async () => {
    const t = await fixture()
    for (const reference of ['general-purpose', 'claude', '@General-Purpose'])
      expect(await t.service.resolveDelegation('u', reference)).toEqual({
        kind: 'self',
        type: 'general-purpose',
      })
  })

  test('the name fork is reserved: a catalog agent called fork is no one a task goes to', async () => {
    const t = await fixture()
    await t.userFile('fork')
    await t.userFile('reviewer')
    for (const reference of ['fork', 'Fork', '@fork'])
      expect(await t.service.resolveDelegation('u', reference)).toEqual({ kind: 'unavailable' })
    expect(await t.service.resolveDelegation('u', 'reviewer')).toMatchObject({ kind: 'agent' })
    const rows = await t.service.directory('u')
    expect(rows.find((row) => row.name === 'fork')).toMatchObject({ delegable: false })
    expect(rows.find((row) => row.name === 'reviewer')).toMatchObject({ delegable: true })
  })

  test('a file named like a built-in replaces it, even general-purpose', async () => {
    const t = await fixture()
    await t.userFile('general-purpose', 'tools: Read\n')
    const target = await t.service.resolveDelegation('u', 'general-purpose')
    expect(target).toMatchObject({ kind: 'agent', definition: { tools: ['read'], source: 'user' } })
    await t.projectFile('Explore')
    // A file that came with the repository waits to be allowed.
    expect(await t.service.resolveDelegation('u', 'Explore', 'p')).toEqual({ kind: 'unavailable' })
    await t.service.setAgentEnabled('u', 'Explore', true, 'p')
    expect(await t.service.resolveDelegation('u', 'Explore', 'p')).toMatchObject({
      kind: 'agent',
      definition: { source: 'project' },
    })
    expect(await t.service.resolveDelegation('u', 'Explore')).toMatchObject({
      definition: { source: 'builtin' },
    })
  })

  test('a plugin agent answers to its full name, and to a bare name only one plugin has', async () => {
    const t = await fixture({ acme: ['reviewer', 'writer'], docs: ['writer'] })
    expect(await t.service.resolveDelegation('u', 'acme:reviewer')).toMatchObject({
      kind: 'agent',
      agent: { handle: 'acme:reviewer' },
    })
    expect(await t.service.resolveDelegation('u', 'reviewer')).toMatchObject({
      kind: 'agent',
      agent: { handle: 'acme:reviewer' },
    })
    expect(await t.service.resolveDelegation('u', 'writer')).toEqual({
      kind: 'ambiguous',
      names: ['acme:writer', 'docs:writer'],
    })
  })

  test('an agent can also be named by its id', async () => {
    const t = await fixture()
    await t.userFile('scribe')
    const found = await t.service.resolveDelegation('u', 'scribe')
    if (found.kind !== 'agent') throw new Error('expected an agent')
    expect(await t.service.resolveDelegation('u', found.agent.id)).toMatchObject({
      kind: 'agent',
      agent: { handle: 'scribe' },
    })
  })

  test('nothing, a switched-off agent and a delegation deny are all unavailable', async () => {
    const t = await fixture()
    await t.userFile('scribe')
    await t.userFile('critic')
    expect(await t.service.resolveDelegation('u', 'nobody')).toEqual({ kind: 'unavailable' })
    const scribe = (await t.service.getAgent('u', 'scribe'))!
    await t.service.setAgentEnabled('u', 'scribe', false)
    expect(await t.service.resolveDelegation('u', 'scribe')).toEqual({ kind: 'unavailable' })
    const critic = (await t.service.getAgent('u', 'critic'))!
    await t.rules.mutate('u', critic.record.id, (rules) => [
      ...rules,
      { action: 'invocation:delegation', resource: critic.record.id, effect: 'deny' },
    ])
    expect(await t.service.resolveDelegation('u', 'critic')).toEqual({ kind: 'unavailable' })
    expect(scribe.record.id).toBeTruthy()
  })

  test('a shipped type starts allowed, and a person’s switch or deny still decides', async () => {
    const t = await fixture()
    await t.rules.mutate('u', 'builtin:Explore', (rules) => [
      ...rules,
      { action: 'invocation:delegation', resource: 'builtin:Explore', effect: 'deny' },
    ])
    expect(await t.service.resolveDelegation('u', 'Explore')).toEqual({ kind: 'unavailable' })
    await t.service.setAgentEnabled('u', 'Plan', false)
    expect(await t.service.resolveDelegation('u', 'Plan')).toEqual({ kind: 'unavailable' })
  })
})

describe('the definition a run is admitted with', () => {
  test('a seat on a shipped type or a file carries the ceiling its file states', async () => {
    const t = await fixture()
    await t.userFile('scribe', 'tools: Read, Grep\nmaxTurns: 4\n')
    const explore = await t.service.resolveRunAgent('u', 'builtin:Explore', 'delegation')
    expect(explore).toMatchObject({
      status: 'allowed',
      agent: { spec: { omitClaudeMd: true, disallowedTools: ['write', 'edit'] } },
    })
    const id = (await t.service.getAgent('u', 'scribe'))!.record.id
    expect(await t.service.resolveRunAgent('u', id, 'delegation')).toMatchObject({
      agent: { spec: { tools: ['read', 'search'], maxTurns: 4 } },
    })
    await t.projectFile('Explore')
    await t.service.setAgentEnabled('u', 'Explore', true, 'p')
    // The project's own Explore replaced the shipped one, which no longer admits.
    expect(await t.service.resolveRunAgent('u', 'builtin:Explore', 'delegation', 'p')).toEqual({
      status: 'agent_not_found',
    })
  })
})

describe('the directory a run reads', () => {
  test('lists every agent with whether it can be tagged in and whether a task can go to it', async () => {
    const t = await fixture({ acme: ['reviewer'] })
    await t.userFile('scribe', 'tools: Read\n')
    await t.userFile('critic')
    const critic = (await t.service.getAgent('u', 'critic'))!
    await t.rules.mutate('u', critic.record.id, (rules) => [
      ...rules,
      { action: 'invocation:delegation', resource: critic.record.id, effect: 'deny' },
    ])
    const rows = await t.service.directory('u')
    const row = (name: string) => rows.find((entry) => entry.name === name)
    expect(row('scribe')).toMatchObject({
      canJoinConversation: true,
      delegable: true,
      tools: ['read'],
    })
    expect(row('critic')).toMatchObject({ canJoinConversation: true, delegable: false })
    expect(row('acme:reviewer')).toMatchObject({ delegable: true })
    expect(row('Explore')).toMatchObject({ delegable: true })
    expect(row('general-purpose')).toMatchObject({ delegable: true, self: true })
  })
})

describe('the agent the main thread runs as', () => {
  test('the settings name resolves to an enabled file agent; the rest is no override', async () => {
    const t = await fixture({ sec: ['auditor'] })
    await t.userFile('reviewer')
    expect(await t.service.resolveMainAgent('u', 'reviewer')).toMatchObject({
      fullName: 'reviewer',
      prompt: expect.stringContaining('Body of reviewer'),
    })
    // A plugin agent by its qualified or its unique bare name, as Claude Code resolves it.
    expect(await t.service.resolveMainAgent('u', 'sec:auditor')).toMatchObject({ name: 'auditor' })
    // Nothing by that name, the default agent itself and `general-purpose` change nothing.
    for (const name of ['nobody', 'localix', 'general-purpose'])
      expect(await t.service.resolveMainAgent('u', name)).toBeNull()
  })

  test('a switched-off agent is not run as', async () => {
    const t = await fixture()
    await t.userFile('reviewer')
    await t.service.setAgentEnabled('u', 'reviewer', false)
    expect(await t.service.resolveMainAgent('u', 'reviewer')).toBeNull()
  })
})
