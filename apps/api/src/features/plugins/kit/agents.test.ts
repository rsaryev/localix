import { describe, expect, test } from 'bun:test'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tempDirPerTest, writeTree } from '@localixai/testing'
import { scopeAgents, type HostAgents, type ScopeAgents } from './agents'
import type { ScopePlugin } from './sessions'
import { diskPluginHost, writeTestPlugin } from './testing'

// sub-agents.md, "Choose the subagent scope": managed over project (the working directory up to the
// repository root, the closest winning) over user over plugin over the built-ins.
const dir = tempDirPerTest('kit-agents')
const agent = (name: string, description: string, extra = '') =>
  `---\nname: ${name}\ndescription: ${description}\n${extra}---\nYou are ${name}.`

const installed = (name: string, agents: Record<string, string>, selected = true) =>
  writeTestPlugin(
    join(dir(), 'plugins', name),
    name,
    Object.fromEntries(Object.entries(agents).map(([file, text]) => [`agents/${file}`, text])),
    selected,
  )

async function read(
  cwd: string,
  plugins: ScopePlugin[] = [],
  policy: unknown = {},
  options: { flag?: HostAgents; env?: NodeJS.ProcessEnv } = {},
) {
  const managed = join(dir(), 'managed')
  writeTree(managed, { 'managed-settings.json': JSON.stringify(policy) })
  const host = diskPluginHost(join(dir(), 'home'), { managedDirectory: managed, env: options.env })
  return scopeAgents(
    host,
    { cwd, homeDir: join(dir(), 'home'), plugins, managed: { dir: managed } },
    { flag: options.flag },
  )
}

const own = (catalog: ScopeAgents) =>
  catalog.agents.filter((one) => one.source !== 'builtin').map((one) => one.fullName)

describe("a scope's subagents, as the kit resolves them", () => {
  test('precedence is managed, closest project, user, plugin, built in; the losers are listed', async () => {
    const repo = join(dir(), 'repo')
    const web = join(repo, 'packages', 'web')
    mkdirSync(join(repo, '.git'), { recursive: true })
    writeTree(dir(), {
      'repo/.claude/agents/review/reviewer.md': agent('reviewer', 'root', 'tools: Read, Grep\n'),
      'repo/packages/web/.claude/agents/reviewer.md': agent('reviewer', 'web'),
      'home/.claude/agents/helper.md': agent('helper', 'mine'),
      'managed/.claude/agents/helper.md': agent('helper', 'org'),
      'repo/.claude/agents/notes.md': '# Just notes',
    })
    const acme = await installed('acme', { 'architect.md': agent('architect', 'plans') })
    const catalog = await read(web, [acme])
    expect(
      catalog.agents
        .filter((one) => one.source !== 'builtin')
        .map((one) => [one.fullName, one.source, one.description]),
    ).toEqual([
      ['helper', 'managed', 'org'],
      ['reviewer', 'project', 'web'],
      ['acme:architect', 'plugin', 'plans'],
    ])
    expect(catalog.agents.find((one) => one.fullName === 'acme:architect')).toMatchObject({
      name: 'architect',
      pluginName: 'acme',
      path: '',
      plugin: { id: 'acme@test', scope: 'user' },
    })
    expect(
      catalog.shadowed.map(({ agent: lost, by }) => [lost.description, by.description]),
    ).toEqual([
      ['root', 'web'],
      ['mine', 'org'],
    ])
    const root = await read(repo)
    expect(root.resolve('reviewer')).toMatchObject({
      agent: {
        description: 'root',
        tools: ['Read', 'Grep'],
        path: join(repo, '.claude/agents/review/reviewer.md'),
      },
    })
  })

  test('the built-ins come from the kit: Explore cannot write and starts without CLAUDE.md', async () => {
    const catalog = await read(join(dir(), 'work'))
    expect(catalog.resolve('Explore')).toMatchObject({
      agent: {
        source: 'builtin',
        prompt: '',
        disallowedTools: ['Write', 'Edit'],
        omitClaudeMd: true,
      },
    })
  })

  test('a name is what Claude Code takes: exact, a plugin agent bare when one plugin has it, a mention', async () => {
    const work = join(dir(), 'work')
    writeTree(work, { '.claude/agents/reviewer.md': agent('reviewer', 'mine') })
    const catalog = await read(work, [
      await installed('acme', {
        'architect.md': agent('architect', 'a'),
        'shared.md': agent('shared', 'a'),
      }),
      await installed('other', { 'shared.md': agent('shared', 'o') }),
    ])
    const named = (reference: string) => {
      const found = catalog.resolve(reference)
      return found && 'agent' in found ? found.agent.fullName : found
    }
    expect(named('reviewer')).toBe('reviewer')
    expect(named('@agent-reviewer')).toBe('reviewer')
    expect(named('Reviewer')).toBeNull()
    expect(named('acme:architect')).toBe('acme:architect')
    expect(named('architect')).toBe('acme:architect')
    expect(named('shared')).toEqual({ ambiguous: ['acme:shared', 'other:shared'] })
    expect(named('nobody')).toBeNull()
    expect(named('  ')).toBeNull()
  })

  test("an unselected plugin's agents are not in the catalog", async () => {
    const off = await installed('off', { 'quiet.md': agent('quiet', 'q') }, false)
    expect(own(await read(join(dir(), 'work'), [off]))).toEqual([])
  })

  test('strictPluginOnlyCustomization agents: the personal and project files do not load', async () => {
    const work = join(dir(), 'work')
    writeTree(dir(), {
      'home/.claude/agents/mine.md': agent('mine', 'm'),
      'work/.claude/agents/proj.md': agent('proj', 'p'),
      'managed/.claude/agents/org.md': agent('org', 'o'),
    })
    expect(own(await read(work)).toSorted()).toEqual(['mine', 'org', 'proj'])
    const locked = await read(work, [], { strictPluginOnlyCustomization: ['agents'] })
    expect(own(locked)).toEqual(['org'])
    expect(locked.agents.some((one) => one.source === 'builtin')).toBe(true)
  })

  // sub-agents.md: `hooks`, `mcpServers` and `permissionMode` are the person's own agent files'
  // to set; they are ignored for a plugin's agent "for security reasons".
  test('a personal file keeps hooks, mcpServers and permissionMode; a plugin agent loads without', async () => {
    const guarded = [
      'permissionMode: plan',
      'tools: Agent(worker, researcher), Read, Bash',
      'hooks:',
      '  Stop:',
      '    - hooks:',
      '        - type: command',
      '          command: ./done.sh',
      'mcpServers:',
      '  - github',
      '',
    ].join('\n')
    const work = join(dir(), 'work')
    writeTree(work, { '.claude/agents/guarded.md': agent('guarded', 'g', guarded) })
    const catalog = await read(work, [
      await installed('acme', { 'guarded.md': agent('loose', 'l', guarded) }),
    ])
    expect(catalog.resolve('guarded')).toMatchObject({
      agent: {
        permissionMode: 'plan',
        hooks: { Stop: [{ hooks: [{ type: 'command', command: './done.sh' }] }] },
        mcpServers: ['github'],
        tools: ['Agent(worker, researcher)', 'Read', 'Bash'],
      },
    })
    const loose = catalog.resolve('acme:loose')
    expect(loose && 'agent' in loose ? loose.agent : null).not.toHaveProperty('hooks')
    expect(loose && 'agent' in loose ? loose.agent : null).not.toHaveProperty('mcpServers')
    expect(loose && 'agent' in loose ? loose.agent : null).not.toHaveProperty('permissionMode')
  })

  // sub-agents.md, "Choose the subagent scope": the `--agents` flag (the SDK `agents` option, what a
  // mod registers) ranks under managed and over project, user and plugin.
  test("the agents a mod registered are the flag source: over the person's files, by name", async () => {
    const work = join(dir(), 'work')
    writeTree(dir(), {
      'home/.claude/agents/runner.md': agent('runner', 'mine'),
      'managed/.claude/agents/org.md': agent('org', 'org'),
    })
    const catalog = await read(
      work,
      [],
      {},
      {
        flag: {
          runner: {
            description: 'registered',
            prompt: 'You run specs.',
            tools: ['Read'],
            permissionMode: 'plan',
            mcpServers: ['github'],
            hooks: { Stop: [{ hooks: [{ type: 'command', command: './done.sh' }] }] },
          },
          org: { description: 'loses', prompt: 'p' },
        },
      },
    )
    expect(catalog.resolve('runner')).toMatchObject({
      agent: {
        source: 'flag',
        description: 'registered',
        prompt: 'You run specs.',
        path: '',
        permissionMode: 'plan',
        mcpServers: ['github'],
        hooks: { Stop: [{ hooks: [{ type: 'command', command: './done.sh' }] }] },
      },
    })
    expect(catalog.resolve('@agent-runner')).toMatchObject({ agent: { source: 'flag' } })
    expect(catalog.resolve('org')).toMatchObject({ agent: { source: 'managed' } })
    expect(catalog.shadowed.map(({ agent: lost, by }) => [lost.source, by.source])).toEqual([
      ['flag', 'managed'],
      ['user', 'flag'],
    ])
  })

  // settings.md, `agent`; plugins/components.md, "Default settings": the main conversation runs as
  // the settings' `agent`, else as the default `agent` of the enabled plugin loaded last.
  test("the main agent: the settings' agent over an enabled plugin's default", async () => {
    const work = join(dir(), 'work')
    const withDefault = (name: string, file: string, selected = true) =>
      writeTestPlugin(
        join(dir(), 'plugins', name),
        name,
        {
          [`agents/${file}.md`]: agent(file, file),
          'settings.json': JSON.stringify({ agent: file }),
        },
        selected,
      )
    const acme = await withDefault('acme', 'lead')
    const off = await withDefault('off', 'boss', false)
    expect((await read(work, [acme, off])).main?.fullName).toBe('acme:lead')
    expect((await read(work, [off])).main).toBeNull()
    writeTree(dir(), {
      'home/.claude/agents/mine.md': agent('mine', 'm'),
      'home/.claude/settings.json': '{"agent":"mine"}',
    })
    expect((await read(work, [acme])).main).toMatchObject({ fullName: 'mine', source: 'user' })
  })

  test('CLAUDE_CONFIG_DIR moves the personal agents folder', async () => {
    writeTree(dir(), {
      'home/.claude/agents/home.md': agent('home', 'h'),
      'config/agents/moved.md': agent('moved', 'm'),
    })
    const catalog = await read(
      join(dir(), 'work'),
      [],
      {},
      {
        env: { CLAUDE_CONFIG_DIR: join(dir(), 'config') },
      },
    )
    expect(own(catalog)).toEqual(['moved'])
    expect(catalog.resolve('moved')).toMatchObject({
      agent: { source: 'user', path: join(dir(), 'config/agents/moved.md') },
    })
  })
})
