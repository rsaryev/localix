import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { capabilityStores } from '../../bootstrap/capability-stores'
import { createDatabase } from '../../db/connection'
import { migrateToLatest } from '../../db/migrator'
import { createCapabilityRuleRepository } from '../capabilities/rule-repository'
import type { HostAgents } from '../plugins/kit'
import { modAgentDefinition } from '../mods/agent-definition'
import { createAgentsService } from './service'
import { testAgentScopes } from './testing'

const cleanup: Array<() => Promise<void>> = []
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run()
})

async function fixture(
  plugins: Record<string, readonly string[]> = {},
  modAgents: HostAgents = {},
  pluginSettings: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {},
) {
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
    ...testAgentScopes({
      root,
      projects: { p: join(root, 'project') },
      plugins: () =>
        Object.entries(plugins).map(([plugin, names]) => ({
          plugin,
          enabled: true,
          agents: names.map((name) => ({ name, description: `${name} from ${plugin}` })),
          ...(pluginSettings[plugin] ? { settings: pluginSettings[plugin] } : {}),
        })),
      mods: () => modAgents,
    }),
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
    /** The person's Claude Code `settings.json`. */
    settings: (json: Readonly<Record<string, unknown>>) =>
      writeFile(join(userClaude, 'settings.json'), JSON.stringify(json)),
  }
}

describe('resolving who a task goes to', () => {
  test('an agent a mod registered runs as its definition: tools, turn limit, model', async () => {
    const { name, definition } = modAgentDefinition({
      name: 'runner',
      description: 'Runs a spec',
      prompt: 'You run specs.',
      tools: ['Read'],
      maxTurns: 4,
      model: 'haiku',
    })
    const t = await fixture({}, { [name]: definition })
    const target = await t.service.resolveDelegation('u', 'runner')
    expect(target).toMatchObject({
      kind: 'agent',
      definition: { fullName: 'runner', source: 'flag', tools: ['Read'], maxTurns: 4 },
    })
  })

  test('a built-in type is a catalog agent with its read-only ceiling', async () => {
    const t = await fixture()
    const target = await t.service.resolveDelegation('u', 'Explore')
    expect(target).toMatchObject({
      kind: 'agent',
      agent: { id: 'builtin:Explore', name: 'Explore' },
      definition: { omitClaudeMd: true, disallowedTools: ['Write', 'Edit'] },
    })
  })

  test('general-purpose, claude and a mention of either run as the delegator', async () => {
    const t = await fixture()
    const typeOf = async (reference: string) => {
      const found = await t.service.resolveDelegation('u', reference)
      return found.kind === 'self' ? found.type : found.kind
    }
    expect(await typeOf('general-purpose')).toBe('general-purpose')
    expect(await typeOf('@agent-general-purpose')).toBe('general-purpose')
    // Behaviour change (kit wins): a name is matched as written, as Claude Code matches it.
    expect(await typeOf('General-Purpose')).toBe('unavailable')
    expect(await typeOf('claude')).toBe('claude')
  })

  // Behaviour change (kit wins): the kit's built-ins carry no tool list of their own.
  test('the other built-in types are catalog agents, with Localix’s prompts', async () => {
    const t = await fixture()
    const found = await t.service.resolveDelegation('u', 'statusline-setup')
    expect(found).toMatchObject({ kind: 'agent', definition: { source: 'builtin' } })
    expect(found.kind === 'agent' && found.definition.prompt).toContain('status line')
    expect(found.kind === 'agent' && found.definition.tools).toBeUndefined()
    expect(await t.service.resolveDelegation('u', 'claude-code-guide')).toMatchObject({
      kind: 'agent',
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
    expect(target).toMatchObject({ kind: 'agent', definition: { tools: ['Read'], source: 'user' } })
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
      agent: { name: 'acme:reviewer' },
    })
    expect(await t.service.resolveDelegation('u', 'reviewer')).toMatchObject({
      kind: 'agent',
      agent: { name: 'acme:reviewer' },
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
      agent: { name: 'scribe' },
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
  test('a session on a shipped type or a file carries the ceiling its file states', async () => {
    const t = await fixture()
    await t.userFile('scribe', 'tools: Read, Grep\nmaxTurns: 4\n')
    const explore = await t.service.resolveRunAgent('u', 'builtin:Explore', 'delegation')
    expect(explore).toMatchObject({
      status: 'allowed',
      agent: { spec: { omitClaudeMd: true, disallowedTools: ['Write', 'Edit'] } },
    })
    const id = (await t.service.getAgent('u', 'scribe'))!.record.id
    expect(await t.service.resolveRunAgent('u', id, 'delegation')).toMatchObject({
      agent: { spec: { tools: ['Read', 'Search'], maxTurns: 4 } },
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
      delegable: true,
      tools: ['Read'],
    })
    expect(row('critic')).toMatchObject({ delegable: false })
    expect(row('acme:reviewer')).toMatchObject({ delegable: true })
    expect(row('Explore')).toMatchObject({ delegable: true })
    expect(row('general-purpose')).toMatchObject({ delegable: true, self: true })
  })
})

describe('the agent the main thread runs as', () => {
  test("the settings' agent, when it is an agent that is on; the rest is no override", async () => {
    const t = await fixture({ sec: ['auditor'] })
    await t.userFile('reviewer')
    await t.settings({ agent: 'reviewer' })
    expect(await t.service.resolveMainAgent('u')).toMatchObject({
      fullName: 'reviewer',
      prompt: expect.stringContaining('Body of reviewer'),
    })
    // A plugin agent by its qualified or its unique bare name, as Claude Code resolves it.
    await t.settings({ agent: 'auditor' })
    expect(await t.service.resolveMainAgent('u')).toMatchObject({ fullName: 'sec:auditor' })
    // Nothing by that name, the default agent itself and `general-purpose` change nothing.
    for (const agent of ['nobody', 'localix', 'general-purpose']) {
      await t.settings({ agent })
      expect(await t.service.resolveMainAgent('u')).toBeNull()
    }
  })

  test("an enabled plugin's default agent, under the settings' own", async () => {
    const t = await fixture({ sec: ['auditor'] }, {}, { sec: { agent: 'auditor' } })
    expect(await t.service.resolveMainAgent('u')).toMatchObject({ fullName: 'sec:auditor' })
    await t.userFile('reviewer')
    await t.settings({ agent: 'reviewer' })
    expect(await t.service.resolveMainAgent('u')).toMatchObject({ fullName: 'reviewer' })
  })

  test('a switched-off agent is not run as', async () => {
    const t = await fixture()
    await t.userFile('reviewer')
    await t.settings({ agent: 'reviewer' })
    await t.service.setAgentEnabled('u', 'reviewer', false)
    expect(await t.service.resolveMainAgent('u')).toBeNull()
  })
})
